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