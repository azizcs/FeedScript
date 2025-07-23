import { executionsClient } from '@dynatrace-sdk/client-automation';
import { notificationsClient } from '@dynatrace-sdk/client-classic-environment-v2';

export default async function ({ execution_id }) {
    // Get the prediction results from the previous task
    const predictionResults = await executionsClient.getTaskExecutionResult({
        executionId: execution_id,
        id: "predict_dist_full_capacity"
    });

    // Check if there are any violations to report
    if (!predictionResults?.violations || predictionResults.violations.length === 0) {
        console.log('No disk capacity violations found - no email will be sent');
        return { message: 'No violations found - email not sent' };
    }

    // Prepare email content
    const emailSubject = `🚨 Disk Capacity Alert: ${predictionResults.violations.length} disks predicted to reach full capacity`;

    let emailBody = `
    <h2>Disk Capacity Forecast Report</h2>
    <p>The following disks are predicted to reach full capacity:</p>
    <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
        <thead>
            <tr>
                <th>Host ID</th>
                <th>Host Name</th>
                <th>Disk ID</th>
                <th>Disk Name</th>
                <th>Current Usage</th>
                <th>Days Until Full</th>
                <th>Predicted Date</th>
            </tr>
        </thead>
        <tbody>
    `;

    // Prepare CSV content
    let csvContent = "Host ID,Host Name,Disk ID,Disk Name,Current Usage (%),Days Until Full,Predicted Date\n";

    // Add each violation to both email body and CSV
    predictionResults.violations.forEach(violation => {
        const formattedDate = new Date(violation.predictedDate).toLocaleDateString();

        // Add to HTML table
        emailBody += `
            <tr>
                <td>${violation.hostId}</td>
                <td>${violation.hostName}</td>
                <td>${violation.diskId}</td>
                <td>${violation.diskName || 'N/A'}</td>
                <td>${violation.currentUsage.toFixed(2)}%</td>
                <td>${violation.daysUntilFull}</td>
                <td>${formattedDate}</td>
            </tr>
        `;

        // Add to CSV
        ...
         += `"${violation.hostId}","${violation.hostName}","${violation.diskId}","${violation.diskName || 'N/A'}","${violation.currentUsage.toFixed(2)}","${violation.daysUntilFull}","${formattedDate}"\n`;
    });

    emailBody += `
        </tbody>
    </table>
    <p>Please see the attached CSV file for the complete dataset.</p>
    <p>Please take appropriate action to prevent service disruptions.</p>
    <p>This is an automated message from Dynatrace Disk Capacity Monitoring.</p>
    `;

    // Convert CSV to base64 for attachment
    const csvBase64 = btoa(unescape(encodeURIComponent(csvContent)));

    // Send the email notification with attachment
    try {
        const response = await notificationsClient.createNotification({
            type: 'EMAIL',
            config: {
                subject: emailSubject,
                body: emailBody,
                recipients: ['your-email@your-company.com'], // Replace with actual recipient(s)
                ccRecipients: [], // Add CC recipients if needed
                bccRecipients: [], // Add BCC recipients if needed
                attachments: [
                    {
                        name: 'disk_capacity_forecast.csv',
                        content: csvBase64,
                        contentType: 'text/csv'
                    }
                ]
            },
        });

        console.log('Email notification with attachment sent successfully:', response);
        return {
            status: 'SUCCESS',
            message: `Email sent with ${predictionResults.violations.length} violations`,
            notificationId: response.id,
            csvRecordCount: predictionResults.violations.length
        };
    } catch (error) {
        console.error('Failed to send email notification:', error);
        throw new Error('Failed to send email notification');
    }
}


import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    // Get prediction results from previous task
    const predictionResults = await executionsClient.getTaskExecutionResult({
        executionId: execution_id,
        id: "predict_dist_full_capacity"
    });

    if (!predictionResults?.violations || predictionResults.violations.length === 0) {
        return {
            shouldSendEmail: false,
            message: "No violations found - skipping email"
        };
    }

    // 1. Generate HTML Email Body
    let emailBody = `
    <h2>Disk Capacity Forecast Report</h2>
    <p>The following disks are predicted to reach full capacity:</p>
    <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
        <thead>
            <tr>
                <th>Host ID</th>
                <th>Host Name</th>
                <th>Disk ID</th>
                <th>Disk Name</th>
                <th>Current Usage</th>
                <th>Days Until Full</th>
                <th>Predicted Date</th>
            </tr>
        </thead>
        <tbody>
    `;

    // 2. Generate CSV Content
    let csvContent = "Host ID,Host Name,Disk ID,Disk Name,Current Usage (%),Days Until Full,Predicted Date\n";

    predictionResults.violations.forEach(violation => {
        const formattedDate = new Date(violation.predictedDate).toLocaleDateString();

        // Add to HTML
        emailBody += `
            <tr>
                <td>${violation.hostId}</td>
                <td>${violation.hostName}</td>
                <td>${violation.diskId}</td>
                <td>${violation.diskName || 'N/A'}</td>
                <td>${violation.currentUsage.toFixed(2)}%</td>
                <td>${violation.daysUntilFull}</td>
                <td>${formattedDate}</td>
            </tr>
        `;

        // Add to CSV
        csvContent += `"${violation.hostId}","${violation.hostName}","${violation.diskId}","${violation.diskName || 'N/A'}","${violation.currentUsage.toFixed(2)}","${violation.daysUntilFull}","${formattedDate}"\n`;
    });

    emailBody += `
        </tbody>
    </table>
    <p>See attached CSV for full details.</p>
    `;

    // 3. Convert CSV to Base64 (required for email attachment)
    const csvBase64 = btoa(unescape(encodeURIComponent(csvContent)));

    return {
        shouldSendEmail: true,
        subject: `🚨 Disk Alert: ${predictionResults.violations.length} disks reaching capacity soon`,
        body: emailBody,
        csvAttachment: csvBase64,
        csvFilename: `disk_forecast_${new Date().toISOString().split('T')[0]}.csv`
    };
}



Step 2: Configure the "Send Email" Task
Now, in the "Send Email" action, use the output from prepare_email_content:

Email Configuration:
Field	Value
Recipients	your-email@your-company.com
Subject	{{prepare_email_content.subject}}
Body	{{prepare_email_content.body}} (select HTML format)
Attachments	Add one with:
- Filename	{{prepare_email_content.csvFilename}}
- Content	{{prepare_email_content.csvAttachment}}
- Content Type	text/csv
Step 3: Add a Condition to Skip Email if No Violations
Before the "Send Email" task, add a condition to check:

plaintext
Copy
Download
{{prepare_email_content.shouldSendEmail}} == true
This ensures the email only sends when there are violations.

Final Workflow Structure
predict_dist_full_capacity (Run Script)

prepare_email_content (Run Script)

Generates HTML body, CSV, subject

Condition: {{prepare_email_content.shouldSendEmail}} == true

send_disk_alert_email (Send Email)

Uses outputs from prepare_email_content