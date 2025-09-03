import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    try {
        // Get all execution results from the predict_disk_full_capacity task
        const taskExecutions = await executionsClient.listTaskExecutions({
            execution_id,
            id: "predict_disk_full_capacity"
        });

        console.log(`Found ${taskExecutions.length} disk prediction executions`);

        // Collect all violations from all loop executions
        const allViolations = [];
        let hasErrors = false;

        for (const taskExecution of taskExecutions) {
            try {
                const result = await executionsClient.getTaskExecutionResult({
                    execution_id,
                    id: taskExecution.id
                });

                // Check if this execution returned a violation object
                if (result && typeof result === 'object') {
                    if (Array.isArray(result)) {
                        // If it's an array of violations, add all
                        allViolations.push(...result.filter(v => v && v.diskId));
                    } else if (result.diskId) {
                        // If it's a single violation object, add it
                        allViolations.push(result);
                    } else if (result.violations) {
                        // If it's the old format with violations array
                        allViolations.push(...result.violations.filter(v => v && v.diskId));
                    }
                }
            } catch (error) {
                console.error(`Failed to get results from execution ${taskExecution.id}:`, error);
                hasErrors = true;
            }
        }

        // Check if there are any violations to report
        if (allViolations.length === 0) {
            console.log('No disk capacity violations found - no email will be sent');
            if (hasErrors) {
                console.log('Note: Some prediction executions had errors');
            }
            return { shouldSendEmail: false };
        }

        console.log(`Found ${allViolations.length} violations across all executions`);
        console.log('Violations sample:', JSON.stringify(allViolations.slice(0, 3), null, 2));

        // Prepare email content
        const emailSubject = `Disk Health Report - ${allViolations.length} Critical Disk(s)`;
        const chartUrl = "https://prod-id.apps.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard/5482bcf7-1fq7-434f-b413-7fa9b5bb8b45";

        // Generate CSV with requested fields
        const csvHeader = "HostId,HostName,DiskId,Instance,CurrentUsage (%),DaysToFailure,PredictedDate,Chart";

        const csvRows = allViolations.map(v => [
            `"${v.hostId || 'N/A'}"`,
            `"${v.hostName || 'N/A'}"`,
            `"${v.diskId}"`,
            `"${v.diskName ? v.diskName.replace(/"/g, '""') : v.diskId}"`, // Escape quotes in disk name
            v.currentUsage?.toFixed(2) || 'N/A',
            v.daysUntilFull || v.daysLeft || 'N/A',
            `"${v.predictedDate || 'N/A'}"`,
            `"${chartUrl}"`
        ].join(','));

        // Combine into final CSV content
        const emailBody = [csvHeader, ...csvRows].join('\r\n');

        return {
            shouldSendEmail: true,
            subject: emailSubject,
            body: emailBody,
            to: "storage-team@company.com",
            cc: "sre-team@company.com",
            isHtml: false
        };

    } catch (error) {
        console.error('Failed to format email:', error);
        return {
            shouldSendEmail: false,
            error: error.message
        };
    }
}