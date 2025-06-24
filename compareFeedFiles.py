import xml.etree.ElementTree as ET
import pandas as pd
from collections import defaultdict
import sys
from datetime import datetime

# Role mappings
SCHEDULING_ROLE_MAP = {
    'SCHEDULING_APS-eBSS': 'APS-eBSS',
    'SCHEDULING_APS-BSS': 'APS-BSS',
    'SCHEDULING_Support Services': 'Support Services',
    'SCHEDULING_EBX-CS': 'EBX-CS',
    'SCHEDULING_Development Services': 'Development Services',
    'SCHEDULING_Production Control': 'Production Control',
    'SCHEDULING_Other': 'Other',
    'SCHEDULING_Administrator': 'Administrator',
    'SCHEDULING_MIX/ISS/DBS/MNT/NGS': 'MIX/ISS/DBS/MNT/NG5'
}

ONREQUEST_ROLE_MAP = {
    'AWF REQUEST FOR SERVICES_STS Manager': 'STS Manager',
    'AWF REQUEST FOR SERVICES_STS Administrator': 'STS Administrator',
    'AWF REQUEST FOR SERVICES_System Administrator': 'System Administrator',
    'AWF_OnRequest Admin': 'OnRequest Admin',
    'AWF_OnRequest User': 'OnRequest User',
    'AWF REQUEST FOR SERVICES_AWF User': 'AWF User'
}


def parse_xml(xml_file):
    """Parse XML file and extract user roles with mappings applied."""
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        xml_users = defaultdict(set)

        for account in root.findall('.//account'):
            user_id = account.get('id')
            for role in account.findall('.//attributeValueRef'):
                role_id = role.get('id')
                if role_id.startswith('Role='):
                    role_name = role_id[5:]  # Remove 'Role=' prefix
                    # Apply mappings if available
                    if role_name in SCHEDULING_ROLE_MAP:
                        xml_users[user_id].add(SCHEDULING_ROLE_MAP[role_name])
                    elif role_name in ONREQUEST_ROLE_MAP:
                        xml_users[user_id].add(ONREQUEST_ROLE_MAP[role_name])
                    else:
                        xml_users[user_id].add(role_name)
        return xml_users

    except ET.ParseError as e:
        sys.exit(f"Error parsing XML file: {e}")
    except Exception as e:
        sys.exit(f"Unexpected error reading XML: {e}")


def parse_excel(excel_file):
    """Parse Excel file with headers starting at C6."""
    try:
        # Read scheduling sheet - skip first 5 rows and use row 6 as header
        sched_df = pd.read_excel(excel_file, sheet_name='Scheduling', header=5, usecols="C:K")

        # Check if required columns exist
        if 'User_ID' not in sched_df.columns or 'ROLENAME' not in sched_df.columns:
            missing = [col for col in ['User_ID', 'ROLENAME'] if col not in sched_df.columns]
            sys.exit(f"Error: Required columns missing in Scheduling sheet: {', '.join(missing)}")

        # Get all users (including those with empty roles)
        sched_all_users = set(sched_df['User_ID'])
        # Users with valid roles
        sched_valid = sched_df[sched_df['ROLENAME'].notna()]
        sched_users = {row['User_ID']: row['ROLENAME'] for _, row in sched_valid.iterrows()}
        sched_empty = sched_df[sched_df['ROLENAME'].isna()]['User_ID'].tolist()

        # Read onrequest sheet - skip first 5 rows and use row 6 as header
        onreq_df = pd.read_excel(excel_file, sheet_name='OnRequest', header=5, usecols="C:K")

        # Check if required columns exist
        if 'User_ID' not in onreq_df.columns or 'ROLENAME' not in onreq_df.columns:
            missing = [col for col in ['User_ID', 'ROLENAME'] if col not in onreq_df.columns]
            sys.exit(f"Error: Required columns missing in OnRequest sheet: {', '.join(missing)}")

        # Get all users (including those with empty roles)
        onreq_all_users = set(onreq_df['User_ID'])
        # Users with valid roles
        onreq_valid = onreq_df[onreq_df['ROLENAME'].notna()]
        onreq_users = {row['User_ID']: row['ROLENAME'] for _, row in onreq_valid.iterrows()}
        onreq_empty = onreq_df[onreq_df['ROLENAME'].isna()]['User_ID'].tolist()

        return sched_users, onreq_users, sched_empty, onreq_empty, sched_all_users, onreq_all_users

    except ImportError:
        sys.exit("Error: Missing required package 'openpyxl'. Please install with:\npip install openpyxl")
    except FileNotFoundError:
        sys.exit(f"Error: Excel file '{excel_file}' not found")
    except Exception as e:
        sys.exit(f"Error reading Excel file: {str(e)}")


def compare_data(xml_users, sched_users, onreq_users, sched_all_users, onreq_all_users):
    """Compare XML and Excel data, identifying discrepancies with role validation."""
    xml_user_ids = set(xml_users.keys())
    excel_user_ids_with_roles = set(sched_users.keys()).union(set(onreq_users.keys()))
    excel_all_user_ids = sched_all_users.union(onreq_all_users)

    # User presence differences
    only_in_xml = xml_user_ids - excel_all_user_ids
    only_in_excel = excel_all_user_ids - xml_user_ids

    # Find role mismatches in common users
    mismatches = []
    common_users = xml_user_ids.intersection(excel_user_ids_with_roles)

    for user in common_users:
        # Get roles from both sources
        xml_roles = xml_users.get(user, set())
        excel_sched_role = sched_users.get(user, None)
        excel_onreq_role = onreq_users.get(user, None)

        # Check scheduling roles
        has_sched_in_xml = any(role in SCHEDULING_ROLE_MAP.values() for role in xml_roles)
        has_sched_in_excel = excel_sched_role is not None

        # Check onrequest roles
        has_onreq_in_xml = any(role in ONREQUEST_ROLE_MAP.values() for role in xml_roles)
        has_onreq_in_excel = excel_onreq_role is not None

        # Role validation
        sched_role_match = (not has_sched_in_xml and not has_sched_in_excel) or \
                           (has_sched_in_xml and has_sched_in_excel and
                            excel_sched_role in [r for r in xml_roles if r in SCHEDULING_ROLE_MAP.values()])

        onreq_role_match = (not has_onreq_in_xml and not has_onreq_in_excel) or \
                           (has_onreq_in_xml and has_onreq_in_excel and
                            excel_onreq_role in [r for r in xml_roles if r in ONREQUEST_ROLE_MAP.values()])

        # Record mismatches
        if not sched_role_match or not onreq_role_match:
            xml_sched_roles = ', '.join(r for r in xml_roles if r in SCHEDULING_ROLE_MAP.values())
            xml_onreq_roles = ', '.join(r for r in xml_roles if r in ONREQUEST_ROLE_MAP.values())

            mismatches.append({
                'User_ID': user,
                'XML_Scheduling_Roles': xml_sched_roles if xml_sched_roles else '',
                'Excel_Scheduling_Role': excel_sched_role if excel_sched_role else '',
                'Scheduling_Mismatch': '✗' if not sched_role_match else '',
                'XML_OnRequest_Roles': xml_onreq_roles if xml_onreq_roles else '',
                'Excel_OnRequest_Role': excel_onreq_role if excel_onreq_role else '',
                'OnRequest_Mismatch': '✗' if not onreq_role_match else ''
            })

    return {
        'only_in_xml': sorted(only_in_xml),
        'only_in_excel': sorted(only_in_excel),
        'role_mismatches': pd.DataFrame(mismatches),
        'matching_users': len(common_users) - len(mismatches),
        'excel_users_with_empty_roles': sorted(
            (sched_all_users - set(sched_users.keys()) | (onreq_all_users - set(onreq_users.keys()))))
    }


def export_results(results, sched_empty, onreq_empty, output_file):
    """Export comparison results to Excel file with additional sheets for empty roles."""
    try:
        with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
            # Summary Sheet
            summary_data = {
                'Metric': [
                    'Comparison Date',
                    'Total XML Users',
                    'Total Excel Users',
                    'Users only in XML',
                    'Users only in Excel',
                    'Users with matching roles',
                    'Users with role mismatches',
                    'Scheduling mismatches',
                    'OnRequest mismatches',
                    'Users with empty Scheduling ROLENAME',
                    'Users with empty OnRequest ROLENAME',
                    'Excel users with empty roles (all)'
                ],
                'Value': [
                    datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    len(results['only_in_xml']) + len(results['role_mismatches']) + results['matching_users'],
                    len(results['only_in_excel']) + len(results['role_mismatches']) + results['matching_users'],
                    len(results['only_in_xml']),
                    len(results['only_in_excel']),
                    results['matching_users'],
                    len(results['role_mismatches']),
                    sum(1 for r in results['role_mismatches'].to_dict('records') if r['Scheduling_Mismatch'] == '✗'),
                    sum(1 for r in results['role_mismatches'].to_dict('records') if r['OnRequest_Mismatch'] == '✗'),
                    len(sched_empty),
                    len(onreq_empty),
                    len(results['excel_users_with_empty_roles'])
                ]
            }
            pd.DataFrame(summary_data).to_excel(writer, sheet_name='Summary', index=False)

            # Mismatches Sheet
            if not results['role_mismatches'].empty:
                results['role_mismatches'].to_excel(writer, sheet_name='Role Mismatches', index=False)
            else:
                pd.DataFrame({'Message': ['No role mismatches found']}).to_excel(
                    writer, sheet_name='Role Mismatches', index=False)

            # Users only in XML
            if results['only_in_xml']:
                pd.DataFrame({'User_ID': results['only_in_xml']}).to_excel(
                    writer, sheet_name='XML Only Users', index=False)
            else:
                pd.DataFrame({'Message': ['No users only in XML']}).to_excel(
                    writer, sheet_name='XML Only Users', index=False)

            # Users only in Excel (including those with empty roles)
            if results['only_in_excel']:
                pd.DataFrame({'User_ID': results['only_in_excel']}).to_excel(
                    writer, sheet_name='Excel Only Users', index=False)
            else:
                pd.DataFrame({'Message': ['No users only in Excel']}).to_excel(
                    writer, sheet_name='Excel Only Users', index=False)

            # Users with empty Scheduling ROLENAME
            if sched_empty:
                pd.DataFrame({'User_ID': sched_empty}).to_excel(
                    writer, sheet_name='Empty Scheduling Roles', index=False)
            else:
                pd.DataFrame({'Message': ['No users with empty Scheduling ROLENAME']}).to_excel(
                    writer, sheet_name='Empty Scheduling Roles', index=False)

            # Users with empty OnRequest ROLENAME
            if onreq_empty:
                pd.DataFrame({'User_ID': onreq_empty}).to_excel(
                    writer, sheet_name='Empty OnRequest Roles', index=False)
            else:
                pd.DataFrame({'Message': ['No users with empty OnRequest ROLENAME']}).to_excel(
                    writer, sheet_name='Empty OnRequest Roles', index=False)

            # All Excel users with empty roles (combined)
            if results['excel_users_with_empty_roles']:
                pd.DataFrame({'User_ID': results['excel_users_with_empty_roles']}).to_excel(
                    writer, sheet_name='All Empty Roles', index=False)

    except Exception as e:
        sys.exit(f"Error exporting to Excel: {e}")


def main():
    print("AWF Role Comparison Tool\n" + "=" * 25)

    # Configuration
    XML_FILE = 'AWF_01_accounts.xml'
    EXCEL_FILE = 'AWF_List.xlsx'
    OUTPUT_FILE = 'AWF_Role_Comparison_Results_12.xlsx'

    try:
        # Process files
        print("\n[1/3] Parsing XML file...")
        xml_users = parse_xml(XML_FILE)

        print("[2/3] Parsing Excel file...")
        sched_users, onreq_users, sched_empty, onreq_empty, sched_all_users, onreq_all_users = parse_excel(EXCEL_FILE)

        print("[3/3] Comparing data...")
        results = compare_data(xml_users, sched_users, onreq_users, sched_all_users, onreq_all_users)

        # Display quick summary
        print("\nComparison Results:")
        print(f"- Users only in XML: {len(results['only_in_xml'])}")
        print(f"- Users only in Excel: {len(results['only_in_excel'])} (including those with empty roles)")
        print(f"- Users with matching roles: {results['matching_users']}")
        print(f"- Users with role mismatches: {len(results['role_mismatches'])}")
        print(f"- Users with empty Scheduling ROLENAME: {len(sched_empty)}")
        print(f"- Users with empty OnRequest ROLENAME: {len(onreq_empty)}")
        print(f"- All Excel users with empty roles: {len(results['excel_users_with_empty_roles'])}")

        # Export results
        print(f"\nExporting results to {OUTPUT_FILE}...")
        export_results(results, sched_empty, onreq_empty, OUTPUT_FILE)
        print("Done! Results exported successfully.")
    except Exception as e:
        print(f"\nError: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()