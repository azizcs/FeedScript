function calculateDaysToFullCapacity(result) {
    if (result?.executionStatus !== 'COMPLETED') return;

    result.output.forEach(prediction => {
        if (prediction.analysisStatus === 'OK' && prediction.forecastQualityAssessment === 'VALID') {
            const records = prediction.timeSeriesDataWithPredictions?.records?.[0];

            // Safely get current usage (last data point before forecast)
            const usageData = records?.['max(dt.host.disk.used.percent)'];
            const currentUsage = Array.isArray(usageData) ? usageData.slice(-1)[0] : null;

            // Safely get forecast values
            const forecastValues = records?.['dt.davis.forecast'] || [];

            if (currentUsage && forecastValues.length) {
                const daysToFull = forecastValues.findIndex(val => val >= 100);

                if (daysToFull >= 0 && currentUsage < 100) {
                    predictionSummary.violations.push({
                        diskId: records['dt.entity.disk'],
                        diskName: records['disk.name'],
                        hostName: records['host.name'],
                        currentUsage: currentUsage,
                        daysUntilFull: daysToFull + 1,
                        predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
                    });
                }
            }
        }
    });
}



//console.log("Records structure:", JSON.stringify(records, null, 2));
//console.log("Analyzer raw output:", JSON.stringify(result, null, 2));