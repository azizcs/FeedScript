import { analyzersClient } from '@dynatrace-sdk/client-davis-analyzers';

export default async function ({ execution_id, loopItemValue }) {
    // ✅ Use loopItemValue instead of entity
    console.log("All parameters:", JSON.stringify(arguments[0], null, 2));
    
    if (!loopItemValue?.disk) {
        console.log("No disk ID provided - skipping");
        return { skip: true };
    }

    // Extract disk and host information
    const diskId = loopItemValue.disk;
    const hostId = loopItemValue.id;
    const hostName = loopItemValue['entity.name'] || 'Unknown';

    console.log(`Processing disk: ${diskId} on host ${hostName} (${hostId})`);

    try {
        // Build query for single disk
        const query = `timeseries max(dt.host.disk.used.percent), 
                     by: {dt.entity.disk, dt.entity.host, host.name}, 
                     from: now()-30d,
                     filter: dt.entity.disk == "${diskId}"`;

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

        // Process result
        const result = response.result.executionStatus !== "COMPLETED" 
            ? await pollAnalyzer(response) 
            : response.result;

        return processDiskResult(result, diskId, hostId, hostName);

    } catch (error) {
        console.error(`Failed to process disk ${diskId}:`, error.message);
        return { 
            error: error.message, 
            diskId: diskId,
            hostId: hostId
        };
    }
}

function processDiskResult(result, diskId, hostId, hostName) {
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

    if (daysToFull >= 0 && currentUsage && currentUsage < 100) {
        const violation = {
            diskId: diskId,
            diskName: forecastRecords['disk.name'] || diskId, // Try to get name from result
            hostId: hostId,
            hostName: hostName,
            currentUsage: Math.round(currentUsage * 100) / 100,
            daysUntilFull: daysToFull + 1,
            predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
        };

        console.log(`🚨 Violation: Disk ${violation.diskName} on ${hostName} - ${violation.daysUntilFull} days until full`);
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
        if (pollCount > 30) throw new Error("Polling timeout");

        const token = response.requestToken;
        analyzerData = await analyzersClient.pollAnalyzerExecution({
            analyzerName: 'davis.anomaly_detection.GenericForecastAnalyzer',
            requestToken: token,
        });

        console.log(`Polling attempt ${pollCount}: ${analyzerData.result.executionStatus}`);
        await new Promise(resolve => setTimeout(resolve, 2000));

    } while (analyzerData.result.executionStatus !== "COMPLETED");

    return analyzerData.result;
}