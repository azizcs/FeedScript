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
    'SCHEDULING_MIX/ISS/DBS/MNT/NGS': 'MIX/ISS/DBS/MNT/NG5',
    'SCHEDULING_EBX-D': 'EBX-D'
}

ONREQUEST_ROLE_MAP = {
    'AWF REQUEST FOR SERVICES_STS Manager': 'STS Manager',
    'AWF REQUEST FOR SERVICES_STS Administrator': 'STS Administrator',
    'AWF REQUEST FOR SERVICES_System Administrator': 'System Administrator',
    'AWF_OnRequest Admin': 'OnRequest Admin',
    'AWF_OnRequest User': 'OnRequest User',
    'AWF REQUEST FOR SERVICES_AWF User': 'AWF User'
}

# New role mappings
ADDITIONAL_ROLE_MAPS = {
    'RESTORE_Administrator': 'Administrator',
    'RESTORE_User': 'User',
    'DOCUPDATE_Administrator': 'Administrator',
    'DOCUPDATE_User': 'User',
    'NOTIFY_Administrator': 'Administrator',
    'NOTIFY_User': 'User',
    'NOTIFY_SYSTEMADMIN': 'SYSTEMADMIN',
    'REFRINT_User': 'User',
    'REPRINT_Administrator': 'Administrator'
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
                    elif role_name in ADDITIONAL_ROLE_MAPS:
                        xml_users[user_id].add(ADDITIONAL_ROLE_MAPS[role_name])
                    else:
                        xml_users[user_id].add(role_name)
        return xml_users

    except ET.ParseError as e:
        sys.exit(f"Error parsing XML file: {e}")
    except Exception as e:
        sys.exit(f"Unexpected error reading XML: {e}")


def parse_excel(excel_file):
    """Parse Excel file and extract user roles with ACF2ID/NOVELLID mapping."""
    try:
        # Read ACF2ID to NOVELLID mapping sheet
        id_map_df = pd.read_excel(excel_file, sheet_name='AWF_ACF2IDNOVELL', header=5, usecols="C:D")
        id_map = {}
        if not id_map_df.empty:
            id_map = dict(zip(id_map_df['ACF2ID'].dropna().astype(str).str.strip(),
                              id_map_df['NOVELLID'].dropna().astype(str).str.strip()))
        reverse_id_map = {v: k for k, v in id_map.items()}

        # Sheets to process (including AWFEMPLOYEE which appears to be the main sheet now)
        sheets_to_check = [
            'AWFEMPLOYEE', 'AWF_USERS'
        ]

        excel_users = defaultdict(set)
        empty_role_users = set()

        for sheet in sheets_to_check:
            try:
                # Try reading with header=5 first
                df = pd.read_excel(excel_file, sheet_name=sheet, header=5)

                # If no data, try with header=0 as fallback
                if df.empty:
                    df = pd.read_excel(excel_file, sheet_name=sheet, header=0)

                # Find User_ID column (case insensitive)
                user_col = None
                for col in df.columns:
                    if 'user_id' in str(col).lower():
                        user_col = col
                        break

                if user_col is None:
                    print(f"Warning: Could not find User_ID column in {sheet} sheet")
                    continue

                # Process each user
                for _, row in df.iterrows():
                    user_id = str(row[user_col]).strip()
                    if not user_id or user_id == 'nan':
                        continue

                    # Handle different role columns based on sheet
                    if sheet == 'AWFEMPLOYEE':
                        # Check all possible role columns
                        role_columns = ['SCHEDULING', 'NOTIFY', 'REPRINT', 'DOCUPDATE', 'RESTORE']
                        for role_col in role_columns:
                            if role_col in row:
                                role = str(row[role_col]).strip()
                                if role and role != 'nan':
                                    excel_users[user_id].add(role)
                    else:  # AWF_USERS sheet
                        if 'ROLENAME' in row:
                            role = str(row['ROLENAME']).strip()
                            if role and role != 'nan' and role != 'NULL':
                                excel_users[user_id].add(role)
                            elif role == 'NULL':
                                empty_role_users.add(user_id)

            except Exception as e:
                print(f"Warning: Error processing {sheet} sheet - {str(e)}")
                continue

        return {
            'excel_users': excel_users,
            'empty_role_users': empty_role_users,
            'id_map': id_map,
            'reverse_id_map': reverse_id_map
        }

    except ImportError:
        sys.exit("Error: Missing required package 'openpyxl'. Please install with:\npip install openpyxl")
    except FileNotFoundError:
        sys.exit(f"Error: Excel file '{excel_file}' not found")
    except Exception as e:
        sys.exit(f"Error reading Excel file: {str(e)}")


def compare_data(xml_users, excel_data):
    """Compare XML and Excel data, handling ID mappings and role validation."""
    excel_users = excel_data['excel_users']
    empty_role_users = excel_data['empty_role_users']
    id_map = excel_data['id_map']
    reverse_id_map = excel_data['reverse_id_map']

    # Function to get all possible IDs for a user considering mappings
    def get_all_possible_ids(user_id):
        ids = {user_id}
        if user_id in id_map:
            ids.add(id_map[user_id])
        if user_id in reverse_id_map:
            ids.add(reverse_id_map[user_id])
        return ids

    # Find users only in XML (considering ID mappings)
    only_in_xml = set()
    for xml_user in xml_users:
        found = False
        for possible_id in get_all_possible_ids(xml_user):
            if possible_id in excel_users:
                found = True
                break
        if not found:
            only_in_xml.add(xml_user)

    # Find users only in Excel (not in XML, considering ID mappings)
    only_in_excel = set()
    for excel_user in excel_users:
        found = False
        for possible_id in get_all_possible_ids(excel_user):
            if possible_id in xml_users:
                found = True
                break
        if not found:
            only_in_excel.add(excel_user)

    # Find role mismatches for common users
    mismatches = []
    matching_users = 0

    for excel_user, excel_roles in excel_users.items():
        # Find corresponding XML user (considering mappings)
        xml_user = None
        for possible_id in get_all_possible_ids(excel_user):
            if possible_id in xml_users:
                xml_user = possible_id
                break

        if not xml_user:
            continue  # User only in Excel (handled above)

        xml_roles = xml_users.get(xml_user, set())

        # Check for missing roles in Excel
        missing_in_excel = xml_roles - excel_roles
        # Check for extra roles in Excel
        extra_in_excel = excel_roles - xml_roles

        if missing_in_excel or extra_in_excel:
            mismatches.append({
                'User_ID': excel_user,
                'XML_Roles': ', '.join(sorted(xml_roles)) if xml_roles else '',
                'Excel_Roles': ', '.join(sorted(excel_roles)) if excel_roles else '',
                'Missing_in_Excel': ', '.join(sorted(missing_in_excel)) if missing_in_excel else '',
                'Extra_in_Excel': ', '.join(sorted(extra_in_excel)) if extra_in_excel else ''
            })
        else:
            matching_users += 1

    # Find mapped user pairs
    mapped_users = []
    for acf2id, novellid in id_map.items():
        if acf2id in excel_users and novellid in xml_users:
            mapped_users.append(f"{acf2id} (Excel) ↔ {novellid} (XML)")

    return {
        'only_in_xml': sorted(only_in_xml),
        'only_in_excel': sorted(only_in_excel),
        'empty_role_users': sorted(empty_role_users),
        'role_mismatches': pd.DataFrame(mismatches),
        'mapped_users': mapped_users,
        'matching_users': matching_users,
        'total_xml_users': len(xml_users),
        'total_excel_users': len(excel_users),
        'total_mapped_pairs': len(mapped_users)
    }


def export_results(results, output_file):
    """Export comparison results to Excel file."""
    try:
        with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
            # Summary Sheet
            summary_data = {
                'Metric': [
                    'Comparison Date',
                    'Total XML Users',
                    'Total Excel Users',
                    'Mapped User Pairs (ACF2ID ↔ NOVELLID)',
                    'Users with matching roles',
                    'Users with role mismatches',
                    'Users only in XML',
                    'Users only in Excel',
                    'Excel users with empty roles'
                ],
                'Value': [
                    datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    results['total_xml_users'],
                    results['total_excel_users'],
                    results['total_mapped_pairs'],
                    results['matching_users'],
                    len(results['role_mismatches']),
                    len(results['only_in_xml']),
                    len(results['only_in_excel']),
                    len(results['empty_role_users'])
                ]
            }
            pd.DataFrame(summary_data).to_excel(writer, sheet_name='Summary', index=False)

            # Role Mismatches
            if not results['role_mismatches'].empty:
                results['role_mismatches'].to_excel(
                    writer, sheet_name='Role Mismatches', index=False)
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

            # Users only in Excel
            if results['only_in_excel']:
                pd.DataFrame({'User_ID': results['only_in_excel']}).to_excel(
                    writer, sheet_name='Excel Only Users', index=False)
            else:
                pd.DataFrame({'Message': ['No users only in Excel']}).to_excel(
                    writer, sheet_name='Excel Only Users', index=False)

            # Empty role users
            if results['empty_role_users']:
                pd.DataFrame({'User_ID': results['empty_role_users']}).to_excel(
                    writer, sheet_name='Empty Role Users', index=False)
            else:
                pd.DataFrame({'Message': ['No users with empty roles']}).to_excel(
                    writer, sheet_name='Empty Role Users', index=False)

            # Mapped users
            if results['mapped_users']:
                pd.DataFrame({'Mapped_User_Pairs': results['mapped_users']}).to_excel(
                    writer, sheet_name='Mapped Users', index=False)
            else:
                pd.DataFrame({'Message': ['No mapped user pairs found']}).to_excel(
                    writer, sheet_name='Mapped Users', index=False)

    except Exception as e:
        sys.exit(f"Error exporting to Excel: {e}")


def main():
    print("AWF User and Role Comparison Tool\n" + "=" * 40)

    # Configuration
    XML_FILE = 'AWF_01_accounts.xml'
    EXCEL_FILE = 'AWF_List.xlsx'
    OUTPUT_FILE = 'AWF_User_Role_Comparison_Results.xlsx'

    try:
        # Process files
        print("\n[1/3] Parsing XML file...")
        xml_users = parse_xml(XML_FILE)

        print("[2/3] Parsing Excel file...")
        excel_data = parse_excel(EXCEL_FILE)

        print("[3/3] Comparing data...")
        results = compare_data(xml_users, excel_data)

        # Display quick summary
        print("\nComparison Results:")
        print(f"- Total XML users: {results['total_xml_users']}")
        print(f"- Total Excel users: {results['total_excel_users']}")
        print(f"- Mapped user pairs (ACF2ID ↔ NOVELLID): {results['total_mapped_pairs']}")
        print(f"- Users with matching roles: {results['matching_users']}")
        print(f"- Users with role mismatches: {len(results['role_mismatches'])}")
        print(f"- Users only in XML: {len(results['only_in_xml'])}")
        print(f"- Users only in Excel: {len(results['only_in_excel'])}")
        print(f"- Excel users with empty roles: {len(results['empty_role_users'])}")

        # Export results
        print(f"\nExporting results to {OUTPUT_FILE}...")
        export_results(results, OUTPUT_FILE)
        print("Done! Results exported successfully.")
    except Exception as e:
        print(f"\nError: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()