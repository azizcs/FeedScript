import { analyzersClient } from '@dynatrace-sdk/client-davis-analyzers';
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    console.log('[START] Workflow execution started');
    const predictionSummary = { violations: [] };
    
    try {
        // 1. Get disk entities
        console.log('[STEP 1] Fetching disk entities...');
        const entityList = await executionsClient.getTaskExecutionResult({
            execution_id,
            id: "query_entities_disk"
        });
        console.log(`Found ${entityList.records.length} disks to analyze`);

        // 2. Process in batches
        let processedDisks = 0;
        for (let counter = 0; counter < entityList.records.length; counter++) {
            await processDisk(counter);
            processedDisks++;
            if (processedDisks % 50 === 0) {
                console.log(`Progress: Processed ${processedDisks}/${entityList.records.length} disks`);
            }
        }

        // 3. Final output
        console.log('[RESULTS] Summary:', {
            totalDisksAnalyzed: processedDisks,
            criticalDisksFound: predictionSummary.violations.length,
            sampleViolation: predictionSummary.violations[0] || 'None'
        });
        
        return predictionSummary;

    } catch (error) {
        console.error('[FATAL ERROR]', {
            message: error.message,
            stack: error.stack,
            executionId: execution_id
        });
        throw error;
    }

    async function processDisk(counter) {
        const disk = entityList.records[counter];
        console.debug(`Processing disk ${disk.id} (${disk.entity?.name || 'unnamed'})`);

        try {
            const response = await analyzersClient.executeAnalyzer({
                analyzerName: 'dt.statistics.GenericForecastAnalyzer',
                body: {
                    timeSeriesData: {
                        expression: buildQuery(disk.id),
                    },
                    forecastHorizon: 365
                },
            });

            const result = response.result.executionStatus !== "COMPLETED"
                ? await pollAnalyzer(response)
                : response.result;

            analyzeForecast(result, disk);
        } catch (error) {
            console.warn(`[DISK PROCESSING ERROR] Skipping disk ${disk.id}:`, error.message);
        }
    }

    function buildQuery(diskId) {
        return `timeseries max(dt.host.disk.used.percent), 
                by: {dt.entity.disk, dt.entity.host, host.name}, 
                from: now()-30d, 
                filter: dt.entity.disk == "${diskId}"`;
    }

    function analyzeForecast(result, disk) {
        if (!result?.output) {
            console.warn(`No forecast output for disk ${disk.id}`);
            return;
        }

        result.output.forEach(prediction => {
            try {
                const records = prediction.timeSeriesDataWithPredictions?.records?.[0];
                if (!records) {
                    console.debug(`No records found for disk ${disk.id}`);
                    return;
                }

                console.log(`[DATA STRUCTURE] Disk ${disk.id} records:`, Object.keys(records));

                const usageData = records['max(dt.host.disk.used.percent)'];
                if (!Array.isArray(usageData)) {
                    console.warn(`Invalid usage data format for disk ${disk.id}`);
                    return;
                }

                const currentUsage = usageData.slice(-1)[0];
                const forecastValues = records['dt.davis.forecast'] || [];
                const daysToFull = forecastValues.findIndex(val => val >= 100);

                if (daysToFull >= 0) {
                    console.log(`[ALERT] Disk ${disk.id} will fill in ${daysToFull} days (Current: ${currentUsage}%)`);
                    predictionSummary.violations.push({
                        diskId: disk.id,
                        diskName: disk.entity?.name,
                        hostName: records['host.name'],
                        currentUsage,
                        daysUntilFull: daysToFull + 1,
                        predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
                    });
                } else {
                    console.debug(`Disk ${disk.id} OK (${currentUsage}% used, no 100% prediction)`);
                }
            } catch (error) {
                console.error(`[ANALYSIS ERROR] Disk ${disk.id}:`, error);
            }
        });
    }

    async function pollAnalyzer(response) {
        console.log(`[POLLING] Starting polling for analyzer (Status: ${response.result.executionStatus})`);
        let pollCount = 0;
        
        do {
            pollCount++;
            const token = response.requestToken;
            response = await analyzersClient.pollAnalyzerExecution({
                analyzerName: 'dt.statistics.GenericForecastAnalyzer',
                requestToken: token,
            });
            console.log(`[POLLING] Attempt ${pollCount}: ${response.result.executionStatus}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay between polls
        } while (response.result.executionStatus !== "COMPLETED");
        
        console.log(`[POLLING] Completed after ${pollCount} attempts`);
        return response.result;
    }
}


function calculateDaysToFullCapacity(result) {
    console.log('[DEBUG] Raw analyzer result:', JSON.stringify(result, null, 2));

    if (result?.executionStatus !== 'COMPLETED') {
        console.warn('[WARNING] Analysis not completed');
        return;
    }

    result.output?.forEach((prediction, index) => {
        console.log(`[DEBUG] Processing prediction ${index + 1}/${result.output.length}`);

        try {
            if (prediction.analysisStatus !== 'OK' || prediction.forecastQualityAssessment !== 'VALID') {
                console.debug(`[SKIPPED] Prediction ${index} - Status: ${prediction.analysisStatus}, Quality: ${prediction.forecastQualityAssessment}`);
                return;
            }

            const records = prediction.timeSeriesDataWithPredictions?.records;
            if (!records || records.length === 0) {
                console.warn(`[WARNING] No records found for prediction ${index}`);
                return;
            }

            // Extract the first (and only) record
            const record = records[0];
            console.log('[DEBUG] Record structure:', Object.keys(record));

            // Safely get usage data
            const usageKey = 'max(dt.host,disk.used.percent)';
            const usageData = record[usageKey];

            if (!Array.isArray(usageData)) {
                console.warn(`[WARNING] Invalid usage data format for prediction ${index}`);
                return;
            }

            const currentUsage = usageData[usageData.length - 1]; // Last actual value
            const forecastValues = record['dt.davis.forecast'] || [];
            const daysToFull = forecastValues.findIndex(val => val >= 100);

            if (daysToFull >= 0 && currentUsage < 100) {
                console.log(`[ALERT] Disk will fill in ${daysToFull + 1} days (Current: ${currentUsage}%)`);
                predictionSummary.violations.push({
                    diskId: record['dt.entity.disk'],
                    diskName: record['disk.name'],
                    hostName: record['host.name'],
                    currentUsage: currentUsage,
                    daysUntilFull: daysToFull + 1,
                    predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString(),
                    timeframe: record.timeframe
                });
            } else {
                console.debug(`[OK] Disk usage safe (Current: ${currentUsage}%, Days to fill: ${daysToFull >= 0 ? daysToFull + 1 : 'N/A'})`);
            }
        } catch (error) {
            console.error(`[ERROR] Processing prediction ${index}:`, error);
        }
    });
}