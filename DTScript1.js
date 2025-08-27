export default async function ({ execution_id }) {
    const FORECAST_HORIZON = 90;
    const BATCH_SIZE = 10; // Process disks in smaller batches
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches

    const entityList = await executionsClient.getTaskExecutionResult({
        execution_id,
        id: "query_entities_disk"
    });

    const predictionSummary = {
        violations: [],
        metrics: {
            analyzedDisks: 0,
            failedDisks: 0
        }
    };

    // Process disks in batches to avoid timeout
    const batches = [];
    for (let i = 0; i < entityList.records.length; i += BATCH_SIZE) {
        batches.push(entityList.records.slice(i, i + BATCH_SIZE));
    }

    console.log(`Processing ${batches.length} batches of ${BATCH_SIZE} disks each`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

        // Process each disk in the current batch
        for (const record of batch) {
            if (!record.disk?.id) continue;

            try {
                const result = await processSingleDisk(record);
                if (result) {
                    predictionSummary.violations.push(result);
                }
                predictionSummary.metrics.analyzedDisks++;
            } catch (error) {
                console.error(`Failed to process disk ${record.disk.id}:`, error);
                predictionSummary.metrics.failedDisks++;
            }
        }

        // Add delay between batches to prevent overwhelming the system
        if (batchIndex < batches.length - 1) {
            console.log(`Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
    }

    return predictionSummary;
}

// Separate function to process individual disks
async function processSingleDisk(record) {
    const query = `timeseries max(dt.host.disk.used.percent),
        by: {dt.entity.disk},
        from: now()-30d,
        filter: dt.entity.disk == "${record.disk.id}"
        | fieldsAdd disk.name = entityName(dt.entity.disk),
                   host.name = entityName(dt.entity.host)`;

    const response = await analyzersClient.executeAnalyzer({
        analyzerName: 'dt.statistics.GenericForecastAnalyzer',
        body: {
            timeSeriesData: { expression: query },
            forecastHorizon: FORECAST_HORIZON
        }
    });

    const result = response.result.executionStatus !== "COMPLETED"
        ? await pollAnalyzer(response)
        : response.result;

    const prediction = result.output?.[0];
    if (prediction?.forecastQualityAssessment !== "VALID") {
        return null;
    }

    const forecastRecords = prediction.timeSeriesDataWithPredictions?.records?.[0];
    const lowerForecast = forecastRecords?.['dt.davis.forecast.lower'] || [];
    const daysToFull = lowerForecast.findIndex(val => val >= 100);

    if (daysToFull >= 0) {
        return {
            hostId: record.entity.id,
            hostName: record.entity.name,
            diskId: record.disk.id,
            diskName: record.disk.name,
            currentUsage: forecastRecords['max(dt.host.disk.used.percent)']?.slice(-1)[0],
            daysLeft: daysToFull + 1,
            predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString(),
            certainty: calculateForecastConfidence(forecastRecords, daysToFull)
        };
    }

    return null;
}

// Polling function with timeout protection
async function pollAnalyzer(response, maxPollTime = 60000) {
    const startTime = Date.now();
    let analyzerData;

    do {
        if (Date.now() - startTime > maxPollTime) {
            throw new Error("Polling timeout exceeded");
        }

        const token = response.requestToken;
        analyzerData = await analyzersClient.pollAnalyzerExecution({
            analyzerName: 'dt.statistics.GenericForecastAnalyzer',
            requestToken: token,
        });

        await new Promise(resolve => setTimeout(resolve, 2000));
    } while (analyzerData.result.executionStatus !== "COMPLETED");

    return analyzerData.result;
}

// Simplified confidence calculation
function calculateForecastConfidence(records, dayIndex) {
    const lower = records['dt.davis.forecast.lower']?.[dayIndex] || 100;
    const upper = records['dt.davis.forecast.upper']?.[dayIndex] || 100;
    const rangeWidth = Math.min(100, upper - lower);
    return parseFloat((1 - (rangeWidth / 100)).toFixed(2));
}





import {analyzersClient} from '@dynatrace-sdk/client-davis-analyzers';
import {execution} from '@dynatrace-sdk/automation-utils';
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    const baseQuery = 'timeseries max(dt.host.disk.used.percent), by: {dt.entity.disk,dt.entity.host,host.name}, from:now()-30d, to:now(), interval: 1d, filter: in (dt.entity.disk, array(';
    const entityList = await executionsClient.getTaskExecutionResult({executionId: execution_id, id: "query_entities_disk" });
    const predictionSummary = { violations: [] };

    // Process disk entities from the query result
    const diskEntities = entityList.records.map(record => ({
        id: record.disk?.id || record.disk,
        hostId: record.id,
        hostName: record.entity?.name || 'Unknown'
    }));

    console.log(`Processing ${diskEntities.length} disks in optimized batches`);

    // Process in smaller batches to avoid timeout
    const BATCH_SIZE = 15; // Reduced from 100 to stay under 120s
    let processedBatches = 0;

    for (let startIdx = 0; startIdx < diskEntities.length; startIdx += BATCH_SIZE) {
        const endIdx = Math.min(startIdx + BATCH_SIZE, diskEntities.length);
        const batch = diskEntities.slice(startIdx, endIdx);

        console.log(`Processing batch ${++processedBatches} (disks ${startIdx+1}-${endIdx})`);

        try {
            await processBatch(batch, predictionSummary);
        } catch (error) {
            console.error(`Batch ${processedBatches} failed:`, error.message);
            // Continue with next batch despite errors
        }

        // Exit if we've processed enough to likely hit timeout soon
        if (startIdx + BATCH_SIZE < diskEntities.length) {
            console.log(`Completed batch ${processedBatches} - task will continue with retry`);
            return {
                status: "incomplete",
                processedDisks: endIdx,
                totalDisks: diskEntities.length,
                summary: predictionSummary
            };
        }
    }

    return predictionSummary;

    async function processBatch(batch, summary) {
        let queryString = '';

        // Build query for this batch
        for (let i = 0; i < batch.length; i++) {
            queryString += `"${batch[i].id}"`;
            if (i < batch.length - 1) queryString += ',';
        }

        const fullQuery = baseQuery + queryString + ')) | fieldsAdd disk.name = entityname(dt.entity.disk), host.name = entityname(dt.entity.host)';

        console.log(`Executing analyzer for batch of ${batch.length} disks`);

        const response = await analyzersClient.executeAnalyzer({
            analyzerName: 'dt.statistics.GenericForecastAnalyzer',
            body: {
                timeSeriesData: { expression: fullQuery },
                forecastHorizon: 365
            },
        });

        const analyzerResult = response.result.executionStatus !== "COMPLETED"
            ? await pollWithTimeout(response, 45000) // 45s timeout for polling
            : response.result;

        calculateDaysToFullCapacity(analyzerResult, summary);
    }

    function calculateDaysToFullCapacity(result, summary) {
        if (result?.executionStatus !== 'COMPLETED') {
            console.warn('Analysis not completed. Status:', result?.executionStatus);
            return;
        }

        result.output?.forEach((prediction, index) => {
            if (prediction.analysisStatus !== 'OK' || prediction.forecastQualityAssessment !== 'VALID') {
                return;
            }

            const historicalRecord = prediction.analyzedTimeSeriesQuery?.records?.[0];
            const forecastRecord = prediction.timeSeriesDataWithPredictions?.records?.[0];

            if (!historicalRecord || !forecastRecord) {
                return;
            }

            // 1. Get CURRENT usage from historical data
            const usageData = historicalRecord['max(dt.host.disk.used.percent)'];
            const currentUsage = Array.isArray(usageData) ? usageData.slice(-1)[0] : null;

            // 2. Get LOWER forecast values - FIXED FIELD NAME
            const lowerForecast = forecastRecord['dt.davis.forecast.lower'] || []; // Changed from forecast:lower to forecast.lower
            const daysToFull = lowerForecast.findIndex(val => val >= 100);

            if (daysToFull >= 0 && currentUsage < 100) {
                summary.violations.push({
                    diskId: forecastRecord['dt.entity.disk'],
                    diskName: forecastRecord['disk.name'],
                    hostId: forecastRecord['dt.entity.host'],
                    hostName: forecastRecord['host.name'],
                    currentUsage,
                    daysUntilFull: daysToFull + 1,
                    predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
                });
            }
        });
    }

    async function pollWithTimeout(response, timeoutMs) {
        const startTime = Date.now();
        let analyzerData = response;

        do {
            // Check timeout
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`Polling timeout after ${timeoutMs}ms`);
            }

            const token = analyzerData.requestToken;
            analyzerData = await analyzersClient.pollAnalyzerExecution({
                analyzerName: 'dt.statistics.GenericForecastAnalyzer',
                requestToken: token,
            });

            // Add small delay between polls
            await new Promise(resolve => setTimeout(resolve, 2000));

        } while (analyzerData.result.executionStatus !== "COMPLETED");

        return analyzerData.result;
    }
}