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


import { fetch } from '@dynatrace-sdk/client-core';

export default async function ({ execution_id }) {
    // 1. Fetch prediction results
    const predictionResults = await executionsClient.getTaskExecutionResult({
        executionId: execution_id,
        id: "predict_dist_full_capacity"
    });

    if (!predictionResults?.violations?.length) {
        return { shouldSendEmail: false };
    }

    // 2. Generate HTML & CSV
    let emailBody = `<h2>Disk Alert</h2><table><tr><th>Host</th><th>Disk</th><th>Usage</th></tr>`;
    let csvContent = "Host,Disk,Usage%,Days Until Full\n";

    predictionResults.violations.forEach(violation => {
        emailBody += `<tr><td>${violation.hostName}</td><td>${violation.diskName}</td><td>${violation.currentUsage}%</td></tr>`;
        csvContent += `${violation.hostName},${violation.diskName},${violation.currentUsage},${violation.daysUntilFull}\n`;
    });

    emailBody += `</table>`;

    // 3. Send via API (if permissions exist)
    const response = await fetch('/api/v2/notifications/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            subject: "Disk Alert",
            body: emailBody,
            recipients: ["abdou1aziz.cisse@td.com"],
            attachments: [{
                name: "disk_alert.csv",
                content: btoa(csvContent),
                contentType: "text/csv"
            }]
        })
    });

    return { status: response.ok ? "SUCCESS" : "FAILED" };
}


export default async function () {
    // ... (same as before until CSV generation)

    // 3. Add CSV as a downloadable link (base64 data URL)
    const csvDataUrl = `data:text/csv;base64,${btoa(csvContent)}`;
    emailBody += `<p>Download CSV: <a href="${csvDataUrl}" download="disk_alert.csv">Click Here</a></p>`;

    return {
        shouldSendEmail: true,
        subject: "Disk Alert",
        body: emailBody
    };
}


import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    // 1. Fetch prediction results
    const predictionResults = await executionsClient.getTaskExecutionResult({
        executionId: execution_id,
        id: "predict_dist_full_capacity"
    });

    if (!predictionResults?.violations?.length) {
        return { shouldSendEmail: false };
    }

    // 2. Generate HTML Table with Inline CSS (email-compatible)
    let htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
    </head>
    <body>
    <h2>🚨 Disk Capacity Alerts</h2>
    <p>The following disks will reach capacity soon:</p>
    <table>
        <tr>
            <th>Host Name</th>
            <th>Disk Name</th>
            <th>Current Usage</th>
            <th>Days Until Full</th>
        </tr>
    `;

    // 3. Generate Plain Text Version (fallback)
    let plainText = "Disk Capacity Alerts:\n\n";
    plainText += "Host Name\tDisk Name\tCurrent Usage\tDays Until Full\n";
    plainText += "-------------------------------------------------\n";

    predictionResults.violations.forEach(violation => {
        // Add to HTML
        htmlBody += `
        <tr>
            <td>${violation.hostName}</td>
            <td>${violation.diskName || violation.diskId}</td>
            <td>${violation.currentUsage.toFixed(2)}%</td>
            <td>${violation.daysUntilFull}</td>
        </tr>
        `;

        // Add to Plain Text
        plainText += `${violation.hostName}\t${violation.diskName || violation.diskId}\t${violation.currentUsage.toFixed(2)}%\t${violation.daysUntilFull}\n`;
    });

    // 4. Close HTML
    htmlBody += `
    </table>
    <p><i>This is an automated message. Please take action to prevent outages.</i></p>
    </body>
    </html>
    `;

    return {
        shouldSendEmail: true,
        subject: `⚠️ ${predictionResults.violations.length} disks will reach capacity`,
        htmlBody: htmlBody,
        plainTextBody: plainText
    };
}






import { executionsClient } from '@dynatrace-sdk/client-automation';

export default async function ({ execution_id }) {
    // 1. Fetch prediction results
    const predictionResults = await executionsClient.getTaskExecutionResult({
        executionId: execution_id,
        id: "predict_dist_full_capacity"
    });

    if (!predictionResults?.violations?.length) {
        return { shouldSendEmail: false };
    }

    // 2. Generate HTML Content
    let htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .critical { color: #d9534f; font-weight: bold; }
    </style>
    </head>
    <body>
    <h2>Disk Capacity Forecast Report</h2>
    <table>
        <tr>
            <th>Host ID</th>
            <th>Host Name</th>
            <th>Disk ID</th>
            <th>Disk Name</th>
            <th>Current Usage</th>
            <th>Days Until Full</th>
            <th>Predicted Date</th>
        </tr>
    `;

    // 3. Generate CSV Content
    let csvContent = "Host ID,Host Name,Disk ID,Disk Name,Current Usage (%),Days Until Full,Predicted Date\n";

    predictionResults.violations.forEach(violation => {
        const formattedDate = new Date(violation.predictedDate).toLocaleDateString();
        const isCritical = violation.currentUsage > 90;

        // Escaped HTML row
        htmlBody += `
        <tr>
            <td>${escapeHtml(violation.hostId)}</td>
            <td>${escapeHtml(violation.hostName)}</td>
            <td>${escapeHtml(violation.diskId)}</td>
            <td>${escapeHtml(violation.diskName || 'N/A')}</td>
            <td class="${isCritical ? 'critical' : ''}">${escapeHtml(violation.currentUsage.toFixed(2))}%</td>
            <td>${escapeHtml(violation.daysUntilFull)}</td>
            <td>${escapeHtml(formattedDate)}</td>
        </tr>
        `;

        // CSV row
        csvContent += `"${violation.hostId}","${violation.hostName}","${violation.diskId}","${violation.diskName || 'N/A'}","${violation.currentUsage.toFixed(2)}","${violation.daysUntilFull}","${formattedDate}"\n`;
    });

    // 4. Finalize HTML with CSV download link
    htmlBody += `
    </table>
    <p>Download CSV: <a href="data:text/csv;base64,${btoa(unescape(encodeURIComponent(csvContent))}" download="disk_alert.csv">Click Here</a></p>
    </body>
    </html>
    `;

    return {
        shouldSendEmail: true,
        subject: `⚠️ ${predictionResults.violations.length} disks reaching capacity`,
        body: htmlBody,
        csvBase64: btoa(unescape(encodeURIComponent(csvContent))),
        csvFilename: `disk_alert_${new Date().toISOString().split('T')[0]}.csv`
    };
}

// Helper function to escape HTML special characters
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}



return {
    shouldSendEmail: true,
    subject: `⚠️ ${predictionResults.violations.length} Disk Alerts`,
    // Wrap in MIME headers to force HTML interpretation
    body: [
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        `<!DOCTYPE html>`,
        `<html>`,
        `<head><style>`,
        `  table { border-collapse: collapse; width: 100%; }`,
        `  th, td { padding: 8px; text-align: left; border: 1px solid #ddd; }`,
        `  th { background-color: #f2f2f2; }`,
        `</style></head>`,
        `<body>`,
        htmlTableContent, // Your generated HTML table
        `</body></html>`
    ].join("\n")
};