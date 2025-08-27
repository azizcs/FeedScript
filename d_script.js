import {analyzersClient} from '@dynatrace-sdk/client-davis-analyzers';
import {execution} from '@dynatrace-sdk/automation-utils';
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    //metric query
    const baseQuery = 'timeseries max(dt.host.disk.used.percent), by: {dt.entity.disk,dt.entity.host,host.name}, from:now()-30d, to:now(), interval: 1d, filter: in (dt.entity.disk, array(';
    //get entities to query
    const entityList = await executionsClient.getTaskExecutionResult({executionId: execution_id, id: "query_entities_disk" });
    const predictionSummary = { violations: [] };
    var analyzerResult = '';
    let noElem = 0;
    let queryString = '';

    // Process disk entities from the query result
    const diskEntities = entityList.records.map(record => ({
        id: record.disk,
        hostId: record.id,
        hostName: record['entity,name'] || record['entity name'] || record['entity-name'] || 'Unknown'
    }));

    //batch entities, construct query and start analysis
    for (var counter = 0; counter < diskEntities.length; counter++){
        await process(counter);
    }
    return predictionSummary;

    async function process(counter){
        queryString += '"' + diskEntities[counter].id + '"';
        noElem++;
        if (noElem == 100 || counter == (diskEntities.length - 1)){
            queryString += ')) | fieldsAdd disk.name = entityname(dt.entity.disk), host.name = entityname(dt.entity.host)';
            const analyzerName = 'dt.statistics.GenericForecastAnalyzer';
            const response = await analyzersClient.executeAnalyzer({
                analyzerName,
                body: {
                    timeSeriesData: {
                        expression: baseQuery + queryString,
                    },
                    forecastHorizon: 365 // Longer horizon to find when 100% will be reached
                },
            });

            analyzerResult = response.result.executionStatus !== "COMPLETED"
                ? await poll(response)
                : response;

            calculateDaysToFullCapacity(analyzerResult.result);
            noElem = 0;
            queryString = '';
        }
        else {
            queryString += ',';
        }
    }

    function calculateDaysToFullCapacity(result) {
        console.log('[DEBUG] Starting calculateDaysToFullCapacity');

        if (result?.executionStatus !== 'COMPLETED') {
            console.warn('[WARNING] Analysis not completed. Execution status:', result?.executionStatus);
            return;
        }

        console.log(`[INFO] Processing ${result.output?.length || 0} predictions`);

        result.output?.forEach((prediction, index) => {
            console.log(`\n[PREDICTION ${index + 1}] Processing prediction ${prediction.analyzerExecutionId}`);
            console.log(`- Analysis Status: ${prediction.analysisStatus}`);
            console.log(`- Forecast Quality: ${prediction.forecastQualityAssessment}`);

            if (prediction.analysisStatus !== 'OK' || prediction.forecastQualityAssessment !== 'VALID') {
                console.warn(`[SKIPPED] Prediction ${index} has invalid status/quality`);
                return;
            }

            // Historical data (current usage)
            const historicalRecord = prediction.analyzedTimeSeriesQuery?.expression?.records?.[0];
            console.log('[HISTORICAL] Record keys:', historicalRecord ? Object.keys(historicalRecord) : 'MISSING');

            // Forecast data (future prediction)
            const forecastRecord = prediction.timeSeriesDataWithPredictions?.expression?.records?.[0];
            console.log('[FORECAST] Record keys:', forecastRecord ? Object.keys(forecastRecord) : 'MISSING');

            if (!historicalRecord || !forecastRecord) {
                console.error('[ERROR] Missing historical or forecast records');
                return;
            }

            // 1. Get CURRENT usage from historical data
            const usageData = historicalRecord['max(dt.host.disk.used.percent)'];
            console.log('[HISTORICAL] Usage data samples (first/last):',
                       usageData?.slice(0, 3), '...',
                       usageData?.slice(-3));

            const currentUsage = Array.isArray(usageData) ? usageData.slice(-1)[0] : null;
            console.log(`[CURRENT] Disk usage: ${currentUsage}%`);

            // 2. Get LOWER forecast values
            const lowerForecast = forecastRecord['dt.davis.forecast:lower'] || [];
            console.log('[FORECAST] Lower forecast samples (first/last):',
                       lowerForecast?.slice(0, 3), '...',
                       lowerForecast?.slice(-3));

            // 3. Find first day where lower forecast hits 100%
            const daysToFull = lowerForecast.findIndex(val => val >= 100);
            console.log(`[PREDICTION] Days until 100%: ${daysToFull >= 0 ? daysToFull + 1 : 'Never'}`);

            if (daysToFull >= 0 && currentUsage < 100) {
                console.log(`[ALERT] Disk will reach capacity in ${daysToFull + 1} days!`);
                predictionSummary.violations.push({
                    diskId: forecastRecord['dt.entity.disk'],
                    diskName: forecastRecord['disk.name'],
                    hostId: forecastRecord['dt.entity.host'],
                    hostName: forecastRecord['host.name'],
                    currentUsage,
                    daysUntilFull: daysToFull + 1,
                    predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
                });
            } else {
                console.log('[OK] Disk capacity safe');
            }
        });

        console.log('\n[SUMMARY] Final violations:', predictionSummary.violations.length);
    }

    async function poll(response) {
        let analyzerData;
        do {
            const token = response.requestToken;
            analyzerData = await analyzersClient.pollAnalyzerExecution({
                analyzerName: 'dt.statistics.GenericForecastAnalyzer',
                requestToken: token,
            });
        } while (analyzerData.result.executionStatus !== "COMPLETED");
        return analyzerData;
    }
}