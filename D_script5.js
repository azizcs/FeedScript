import { analyzersClient } from '@dynatrace-sdk/client-davis-analyzers';
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id, entity }) {
    // Use the entity from Dynatrace loop instead of querying again
    if (!entity?.disk?.id) {
        console.log("No disk entity provided");
        return { skip: true };
    }

    console.log(`Processing disk: ${entity.disk.id} (${entity.disk.name})`);

    try {
        // Build query for single disk
        const query = `timeseries max(dt.host.disk.used.percent), 
                     by: {dt.entity.disk, dt.entity.host, host.name}, 
                     from: now()-30d,
                     filter: dt.entity.disk == "${entity.disk.id}"
                     | fieldsAdd disk.name = entityName(dt.entity.disk)`;

        // Execute analyzer
        const response = await analyzersClient.executeAnalyzer({
            analyzerName: 'davis.anomaly_detection.GenericForecastAnalyzer',
            body: {
                timeSeriesData: { expression: query },
                forecastHorizon: 365,
                coverageProbability: 0.9,
                nPaths: 200
            }
        });

        // Get result
        const result = response.result.executionStatus !== "COMPLETED" 
            ? await pollAnalyzer(response) 
            : response.result;

        // Process the result
        return processDiskResult(result, entity);

    } catch (error) {
        console.error(`Failed to process disk ${entity.disk.id}:`, error.message);
        return { error: error.message, diskId: entity.disk.id };
    }
}

function processDiskResult(result, entity) {
    const prediction = result.output?.[0];
    if (!prediction) {
        console.log("No prediction output");
        return null;
    }

    console.log(`Status: ${prediction.analysisStatus}, Quality: ${prediction.forecastQualityAssessment}`);

    if (prediction.analysisStatus !== "OK" || prediction.forecastQualityAssessment !== "VALID") {
        console.log("Skipping - invalid prediction quality");
        return null;
    }

    const forecastRecords = prediction.timeSeriesDataWithPredictions?.records?.[0];
    if (!forecastRecords) {
        console.log("No forecast records");
        return null;
    }

    // Get current usage
    const usageData = forecastRecords['max(dt.host.disk.used.percent)'];
    const currentUsage = Array.isArray(usageData) ? usageData.slice(-1)[0] : null;

    // Get forecast
    const lowerForecast = forecastRecords['dt.davis.forecast.lower'] || [];
    const daysToFull = lowerForecast.findIndex(val => val >= 100);

    if (daysToFull >= 0 && currentUsage < 100) {
        const violation = {
            diskId: entity.disk.id,
            diskName: entity.disk.name,
            hostId: entity.entity.id,
            hostName: entity.entity.name,
            currentUsage: Math.round(currentUsage * 100) / 100,
            daysUntilFull: daysToFull + 1,
            predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
        };

        console.log(`🚨 Violation: ${violation.diskName} - ${violation.daysUntilFull} days until full`);
        return violation;
    }

    console.log("No capacity issue detected");
    return null;
}

async function pollAnalyzer(response) {
    let pollCount = 0;
    let analyzerData = response;

    do {
        pollCount++;
        if (pollCount > 30) {
            throw new Error("Polling timeout after 30 attempts");
        }

        const token = analyzerData.requestToken;
        analyzerData = await analyzersClient.pollAnalyzerExecution({
            analyzerName: 'davis.anomaly_detection.GenericForecastAnalyzer',
            requestToken: token,
        });

        console.log(`Polling attempt ${pollCount}: ${analyzerData.result.executionStatus}`);
        await new Promise(resolve => setTimeout(resolve, 2000));

    } while (analyzerData.result.executionStatus !== "COMPLETED");

    return analyzerData.result;
}