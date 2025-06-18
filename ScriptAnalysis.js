import {analyzersClient} from '@dynatrace-sdk/client-davis-analyzers'; 
import {execution} from '@dynatrace-sdk/automation-utils'; 
import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    //metric query
    const baseQuery = 'timeseries max(dt.host.disk.used.percent), by: {dt.entity.disk,dt.entity.host,host.name), from:now()-30d, to:now(), interval: 1d, filter: in (dt.entity.disk, array(';
    //get entities to query
    const entityList = await executionsClient.getTaskExecutionResult({executiond: execution_id, id: "query_entities_disk" });
    const predictionSummary = { violations: [] };
    var analyzerResult = '';
    let noElem = 0;
    let queryString = '';

    //batch entities, construct query and start analysis
    for (var counter = 0; counter < entityList.records.length; counter++){
        await process(counter);
    }
    return predictionSummary;

    async function process(counter){
        queryString += '"' + entityList.records[counter].id + '"';
        noElem++;
        if (noElem == 100 || counter == (entityList.records.length - 1)){
            queryString += ')) | fieldsAdd disk.name = entityname(dt.entity.disk)';
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
        if (result?.executionStatus !== 'COMPLETED') return;
        
        result.output.forEach(prediction => {
            if (prediction.analysisStatus === 'OK' && prediction.forecastQualityAssessment === 'VALID') {
                const records = prediction.timeSeriesDataWithPredictions.records[0];
                const forecastValues = records['dt.davis.forecast'];
                const currentUsage = records['max(dt.host.disk.used.percent)'].slice(-1)[0];
                
                // Find first day where forecast reaches/exceeds 100%
                const daysToFull = forecastValues.findIndex(val => val >= 100);
                
                if (daysToFull >= 0 && currentUsage < 100) {
                    predictionSummary.violations.push({
                        diskId: records['dt.entity.disk'],
                        diskName: records['disk.name'],
                        hostName: records['host.name'],
                        currentUsage: currentUsage,
                        daysUntilFull: daysToFull + 1, // +1 because array is 0-indexed
                        predictedDate: new Date(Date.now() + (daysToFull + 1) * 86400000).toISOString()
                    });
                }
            }
        });
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