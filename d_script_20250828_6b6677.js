export default async function ({ execution_id }) {
    const FORECAST_HORIZON = 90;
    const DISKS_PER_BATCH = 10;

    const entityList = await executionsClient.getTaskExecutionResult({
        execution_id, 
        id: "query_entities_disk"
    });

    // 1. Load previous results if any
    let predictionSummary = await loadCheckpoint(execution_id) || {
        violations: [],
        metrics: {
            analyzedDisks: 0,
            validPredictions: 0,
            invalidPredictions: 0,
            disksWithViolations: 0,
            startIndex: 0
        }
    };

    const startIndex = predictionSummary.metrics.startIndex;
    console.log(`Resuming from disk ${startIndex + 1}/${entityList.records.length}`);

    // 2. Process current batch
    const endIndex = Math.min(startIndex + DISKS_PER_BATCH, entityList.records.length);
    
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
                    nPaths: 200
                }
            });

            const result = response.result.executionStatus !== "COMPLETED" 
                ? await pollAnalyzer(response) 
                : response.result;

            const violation = processPredictionResult(result, record);
            if (violation) {
                predictionSummary.violations.push(violation);
                predictionSummary.metrics.disksWithViolations++;
            }

            predictionSummary.metrics.analyzedDisks++;

        } catch (error) {
            console.error(`Disk ${record.disk?.id} failed:`, error.message);
        }
    }

    // 3. Update checkpoint for next retry
    predictionSummary.metrics.startIndex = endIndex;

    // 4. Check if completed
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
            summary: predictionSummary // Include current results
        };
    }
}

// Checkpoint management functions
async function loadCheckpoint(execution_id) {
    try {
        const data = await executionsClient.getExecutionData({
            execution_id,
            data_id: "disk_checkpoint"
        });
        console.log("Loaded checkpoint:", data.metrics.startIndex);
        return data;
    } catch (error) {
        console.log("No checkpoint found, starting fresh");
        return null;
    }
}

async function saveCheckpoint(execution_id, summary) {
    await executionsClient.storeExecutionData({
        execution_id,
        data_id: "disk_checkpoint",
        body: summary
    });
}

async function clearCheckpoint(execution_id) {
    try {
        await executionsClient.deleteExecutionData({
            execution_id,
            data_id: "disk_checkpoint"
        });
    } catch (error) {
        // Ignore if no checkpoint exists
    }
}

// Keep your existing processPredictionResult and pollAnalyzer functions
function processPredictionResult(result, record) {
    // ... (same as before)
}

async function pollAnalyzer(response) {
    // ... (same as before)
}