import { analyzersClient } from '@dynatrace-sdk/client-davis-analyzers';
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    const FORECAST_HORIZON = 90;
    const MAX_POLL_ATTEMPTS = 30;

    try {
        // 1. Get disk entities from previous task
        const entityList = await executionsClient.getTaskExecutionResult({
            execution_id, 
            id: "query_entities_disk"
        });

        console.log(`Found ${entityList.records.length} Windows disks to analyze`);

        // 2. Initialize results
        const predictionSummary = {
            violations: [],
            metrics: {
                analyzedDisks: 0,
                validPredictions: 0,
                invalidPredictions: 0,
                disksWithViolations: 0,
                totalDisks: entityList.records.length
            }
        };

        // 3. Process all disks with optimized concurrency
        const processingPromises = [];
        
        for (const record of entityList.records) {
            if (!record.disk?.id) continue;

            // Process disks with limited concurrency
            if (processingPromises.length >= 5) {
                // Wait for one to complete before adding more
                await Promise.race(processingPromises);
            }

            const promise = processSingleDisk(record, predictionSummary)
                .finally(() => {
                    // Remove completed promise from array
                    const index = processingPromises.indexOf(promise);
                    if (index > -1) {
                        processingPromises.splice(index, 1);
                    }
                });

            processingPromises.push(promise);
        }

        // 4. Wait for all remaining disks to complete
        await Promise.all(processingPromises);

        console.log(`✅ COMPLETED: ${predictionSummary.metrics.analyzedDisks} disks processed, ${predictionSummary.violations.length} violations found`);
        return predictionSummary;

    } catch (error) {
        console.error("Fatal error in prediction task:", error);
        throw error;
    }
}

// Process single disk with timeout protection
async function processSingleDisk(record, summary) {
    try {
        const query = `timeseries max(dt.host.disk.used.percent), 
                     by: {dt.entity.disk}, 
                     from: now()-30d,
                     filter: dt.entity.disk == "${record.disk.id}"`;

        console.log(`Analyzing disk ${record.disk.id} (${record.disk.name})`);

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

        // Process the prediction result
        const prediction = result.output?.[0];
        if (!prediction) {
            console.log(`No prediction output for disk ${record.disk.id}`);
            summary.metrics.analyzedDisks++;
            return;
        }

        console.log(`Disk ${record.disk.id}: Status=${prediction.analysisStatus}, Quality=${prediction.forecastQualityAssessment}`);

        if (prediction.analysisStatus !== "OK" || prediction.forecastQualityAssessment !== "VALID") {
            if (prediction.forecastQualityAssessment === "INVALID") {
                summary.metrics.invalidPredictions++;
            }
            summary.metrics.analyzedDisks++;
            return;
        }

        summary.metrics.validPredictions++;

        const forecastRecords = prediction.timeSeriesDataWithPredictions?.records?.[0];
        if (!forecastRecords) {
            console.log(`No forecast records for disk ${record.disk.id}`);
            summary.metrics.analyzedDisks++;
            return;
        }

        const usageData = forecastRecords['max(dt.host.disk.used.percent)'];
        const currentUsage = Array.isArray(usageData) ? usageData.slice(-1)[0] : null;
        
        const lowerForecast = forecastRecords['dt.davis.forecast.lower'] || [];
        const daysToFull = lowerForecast.findIndex(val => val >= 100);

        if (daysToFull >= 0 && currentUsage && currentUsage < 100) {
            const violation = {
                hostId: record.entity.id,
                hostName: record.entity.name,
                diskId: record.disk.id,
                diskName: record.disk.name,
                currentUsage: Math.round(currentUsage * 100) / 100,
                daysLeft: daysToFull + 1,
                predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString().split('T')[0]
            };
            
            summary.violations.push(violation);
            summary.metrics.disksWithViolations++;
            console.log(`🚨 Violation: ${violation.diskName} on ${violation.hostName} - ${violation.daysLeft} days until full`);
        }

        summary.metrics.analyzedDisks++;

    } catch (error) {
        console.error(`Failed to process disk ${record.disk.id}:`, error.message);
        summary.metrics.analyzedDisks++;
    }
}

// Polling function
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
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
    } while (analyzerData.result.executionStatus !== "COMPLETED");

    return analyzerData.result;
}