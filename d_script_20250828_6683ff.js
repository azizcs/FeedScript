import { analyzersClient } from '@dynatrace-sdk/client-davis-analyzers';
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    const FORECAST_HORIZON = 90;
    const DISKS_PER_BATCH = 10;
    const MAX_POLL_ATTEMPTS = 30;

    try {
        // 1. Get disk entities from previous task
        const entityList = await executionsClient.getTaskExecutionResult({
            execution_id, 
            id: "query_entities_disk"
        });

        console.log(`Found ${entityList.records.length} Windows disks to analyze`);

        // 2. Load previous results or initialize new
        let predictionSummary = await loadCheckpoint(execution_id) || {
            violations: [],
            metrics: {
                analyzedDisks: 0,
                validPredictions: 0,
                invalidPredictions: 0,
                disksWithViolations: 0,
                startIndex: 0,
                totalDisks: entityList.records.length
            }
        };

        const startIndex = predictionSummary.metrics.startIndex;
        const endIndex = Math.min(startIndex + DISKS_PER_BATCH, entityList.records.length);

        console.log(`Processing disks ${startIndex + 1}-${endIndex} of ${entityList.records.length}`);

        // 3. Process current batch
        for (let i = startIndex; i < endIndex; i++) {
            const record = entityList.records[i];
            if (!record.disk?.id) continue;

            try {
                const query = `timeseries max(dt.host.disk.used.percent), 
                             by: {dt.entity.disk}, 
                             from: now()-30d,
                             filter: dt.entity.disk == "${record.disk.id}"`;

                const response = await analyzersClient.executeAnalyzer({
                    analyzerName: 'davis.anomaly_detection.GenericForecastAnalyzer',
                    body: {
                        timeSeriesData: { expression: query },
                        forecastHorizon: FORECAST_HORIZON,
                        coverageProbability: 0.9,
                        nPaths: 200,
                        useModelCache: true
                    }
                });

                const result = response.result.executionStatus !== "COMPLETED" 
                    ? await pollAnalyzer(response, MAX_POLL_ATTEMPTS) 
                    : response.result;

                const violation = processPredictionResult(result, record);
                if (violation) {
                    predictionSummary.violations.push(violation);
                    predictionSummary.metrics.disksWithViolations++;
                    console.log(`🚨 Violation: ${violation.diskName} on ${violation.hostName} - ${violation.daysLeft} days until full`);
                }

                predictionSummary.metrics.analyzedDisks++;

            } catch (error) {
                console.error(`Failed to process disk ${record.disk?.id}:`, error.message);
            }
        }

        // 4. Update checkpoint position
        predictionSummary.metrics.startIndex = endIndex;

        // 5. Check if completed
        if (endIndex >= entityList.records.length) {
            console.log(`✅ COMPLETED: ${predictionSummary.metrics.analyzedDisks} disks processed, ${predictionSummary.violations.length} violations found`);
            await clearCheckpoint(execution_id);
            return predictionSummary;
        } else {
            console.log(`⏩ PARTIAL: Processed ${endIndex}/${entityList.records.length} disks. ${predictionSummary.violations.length} violations so far.`);
            await saveCheckpoint(execution_id, predictionSummary);
            return {
                status: "incomplete",
                processed: endIndex,
                total: entityList.records.length,
                summary: predictionSummary
            };
        }

    } catch (error) {
        console.error("Fatal error in prediction task:", error);
        throw error;
    }
}

// Process individual prediction result
function processPredictionResult(result, record) {
    const prediction = result.output?.[0];
    if (!prediction) {
        console.log(`No prediction output for disk ${record.disk.id}`);
        return null;
    }

    console.log(`Disk ${record.disk.id}: Status=${prediction.analysisStatus}, Quality=${prediction.forecastQualityAssessment}`);

    if (prediction.analysisStatus !== "OK" || prediction.forecastQualityAssessment !== "VALID") {
        if (prediction.forecastQualityAssessment === "INVALID") {
            predictionSummary.metrics.invalidPredictions++;
        }
        return null;
    }

    predictionSummary.metrics.validPredictions++;

    const forecastRecords = prediction.timeSeriesDataWithPredictions?.records?.[0];
    if (!forecastRecords) {
        console.log(`No forecast records for disk ${record.disk.id}`);
        return null;
    }

    const usageData = forecastRecords['max(dt.host.disk.used.percent)'];
    const currentUsage = Array.isArray(usageData) ? usageData.slice(-1)[0] : null;
    
    const lowerForecast = forecastRecords['dt.davis.forecast.lower'] || [];
    const daysToFull = lowerForecast.findIndex(val => val >= 100);

    if (daysToFull >= 0 && currentUsage && currentUsage < 100) {
        return {
            hostId: record.entity.id,
            hostName: record.entity.name,
            diskId: record.disk.id,
            diskName: record.disk.name,
            currentUsage: Math.round(currentUsage * 100) / 100,
            daysLeft: daysToFull + 1,
            predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString().split('T')[0],
            analyzedAt: new Date().toISOString()
        };
    }

    return null;
}

// Polling function with timeout protection
async function pollAnalyzer(response, maxAttempts) {
    let pollCount = 0;
    let analyzerData = response;
    
    do {
        pollCount++;
        
        if (pollCount > maxAttempts) {
            throw new Error(`Polling timeout after ${maxAttempts} attempts`);
        }

        const token = analyzerData.requestToken;
        analyzerData = await analyzersClient.pollAnalyzerExecution({
            analyzerName: 'davis.anomaly_detection.GenericForecastAnalyzer',
            requestToken: token,
        });

        console.log(`Polling attempt ${pollCount}: ${analyzerData.result.executionStatus}`);
        
        // Wait before next poll (with increasing delay)
        await new Promise(resolve => setTimeout(resolve, 2000 + (pollCount * 500)));
        
    } while (analyzerData.result.executionStatus !== "COMPLETED");

    return analyzerData.result;
}

// Checkpoint management
async function loadCheckpoint(execution_id) {
    try {
        const data = await executionsClient.getExecutionData({
            execution_id,
            data_id: "disk_prediction_checkpoint"
        });
        console.log(`Loaded checkpoint: ${data.metrics.startIndex} disks processed`);
        return data;
    } catch (error) {
        console.log("No checkpoint found - starting new analysis");
        return null;
    }
}

async function saveCheckpoint(execution_id, summary) {
    try {
        await executionsClient.storeExecutionData({
            execution_id,
            data_id: "disk_prediction_checkpoint",
            body: summary
        });
        console.log(`Checkpoint saved: ${summary.metrics.startIndex} disks processed`);
    } catch (error) {
        console.error("Failed to save checkpoint:", error);
    }
}

async function clearCheckpoint(execution_id) {
    try {
        await executionsClient.deleteExecutionData({
            execution_id,
            data_id: "disk_prediction_checkpoint"
        });
        console.log("Checkpoint cleared");
    } catch (error) {
        // Ignore if no checkpoint exists
    }
}