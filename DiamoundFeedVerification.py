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
    """Parse Excel file with headers starting at C6 and handle ACF2ID/NOVELLID mapping."""
    try:
        # Read ACF2ID to NOVELLID mapping sheet
        id_map_df = pd.read_excel(excel_file, sheet_name='AWF_ACF2IDNOVELL', header=5, usecols="C:D")
        id_map = {row['ACF2ID']: row['NOVELLID'] for _, row in id_map_df.iterrows()}
        reverse_id_map = {v: k for k, v in id_map.items()}

        # Function to get all possible IDs for a user
        def get_all_ids(user_id):
            ids = {user_id}
            if user_id in id_map:
                ids.add(id_map[user_id])
            if user_id in reverse_id_map:
                ids.add(reverse_id_map[user_id])
            return ids

        # Read all relevant sheets
        sheets_to_check = [
            'Scheduling', 'OnRequest', 'ASPNET_Users',
            'AWF_USERACCESSPROFILE', 'AWF_USERS'
        ]

        all_users = set()
        users_with_roles = {}
        empty_role_users = set()

        for sheet in sheets_to_check:
            try:
                df = pd.read_excel(excel_file, sheet_name=sheet, header=5, usecols="C:K")

                # Skip role checking for AWF_USERACCESSPROFILE
                skip_role_check = (sheet == 'AWF_USERACCESSPROFILE')

                if 'User_ID' not in df.columns:
                    print(f"Warning: 'User_ID' column not found in {sheet} sheet")
                    continue

                if not skip_role_check and 'ROLENAME' not in df.columns:
                    print(f"Warning: 'ROLENAME' column not found in {sheet} sheet")
                    continue

                for _, row in df.iterrows():
                    user_id = row['User_ID']
                    all_users.add(user_id)

                    if skip_role_check:
                        continue

                    role = row.get('ROLENAME', None)
                    if pd.isna(role) or role == 'NULL':
                        empty_role_users.add(user_id)
                    else:
                        if user_id not in users_with_roles:
                            users_with_roles[user_id] = set()
                        users_with_roles[user_id].add(role)

            except Exception as e:
                print(f"Warning: Error processing {sheet} sheet - {str(e)}")
                continue

        return {
            'all_users': all_users,
            'users_with_roles': users_with_roles,
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
    xml_user_ids = set(xml_users.keys())
    excel_all_users = excel_data['all_users']
    excel_users_with_roles = excel_data['users_with_roles']
    empty_role_users = excel_data['empty_role_users']
    id_map = excel_data['id_map']
    reverse_id_map = excel_data['reverse_id_map']

    # Function to check if a user exists in XML (considering ID mappings)
    def user_in_xml(user_id):
        # Check direct match
        if user_id in xml_user_ids:
            return True
        # Check if this is an ACF2ID that maps to a NOVELLID in XML
        if user_id in id_map and id_map[user_id] in xml_user_ids:
            return True
        # Check if this is a NOVELLID that maps to an ACF2ID in XML
        if user_id in reverse_id_map and reverse_id_map[user_id] in xml_user_ids:
            return True
        return False

    # Find users only in XML (considering ID mappings)
    only_in_xml = set()
    for xml_user in xml_user_ids:
        # Check if this XML user has a corresponding Excel user (direct or mapped)
        found = False
        if xml_user in excel_all_users:
            found = True
        elif xml_user in reverse_id_map and reverse_id_map[xml_user] in excel_all_users:
            found = True
        elif xml_user in id_map and id_map[xml_user] in excel_all_users:
            found = True

        if not found:
            only_in_xml.add(xml_user)

    # Find users only in Excel (not in XML, considering ID mappings)
    only_in_excel = set()
    for excel_user in excel_all_users:
        if not user_in_xml(excel_user):
            only_in_excel.add(excel_user)

    # Find role mismatches for common users
    mismatches = []

    for excel_user, excel_roles in excel_users_with_roles.items():
        if not user_in_xml(excel_user):
            continue

        # Get the corresponding XML user ID (might be mapped)
        xml_user = excel_user
        if excel_user in id_map and id_map[excel_user] in xml_user_ids:
            xml_user = id_map[excel_user]
        elif excel_user in reverse_id_map and reverse_id_map[excel_user] in xml_user_ids:
            xml_user = reverse_id_map[excel_user]

        xml_roles = xml_users.get(xml_user, set())

        # Check for role mismatches
        role_mismatches = []
        for excel_role in excel_roles:
            if excel_role not in xml_roles:
                role_mismatches.append(excel_role)

        if role_mismatches:
            mismatches.append({
                'User_ID': excel_user,
                'XML_Roles': ', '.join(xml_roles) if xml_roles else '',
                'Excel_Roles': ', '.join(excel_roles),
                'Mismatched_Roles': ', '.join(role_mismatches)
            })

    return {
        'only_in_xml': sorted(only_in_xml),
        'only_in_excel': sorted(only_in_excel),
        'role_mismatches': pd.DataFrame(mismatches),
        'empty_role_users': sorted(empty_role_users),
        'matching_users': len(excel_users_with_roles) - len(mismatches)
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
                    'Users only in XML',
                    'Users only in Excel',
                    'Users with matching roles',
                    'Users with role mismatches',
                    'Excel users with empty roles'
                ],
                'Value': [
                    datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    len(results['only_in_xml']) + len(results['role_mismatches']) + results['matching_users'],
                    len(results['only_in_excel']) + len(results['role_mismatches']) + results['matching_users'],
                    len(results['only_in_xml']),
                    len(results['only_in_excel']),
                    results['matching_users'],
                    len(results['role_mismatches']),
                    len(results['empty_role_users'])
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

            # Users with empty roles
            if results['empty_role_users']:
                pd.DataFrame({'User_ID': results['empty_role_users']}).to_excel(
                    writer, sheet_name='Empty Role Users', index=False)
            else:
                pd.DataFrame({'Message': ['No users with empty roles']}).to_excel(
                    writer, sheet_name='Empty Role Users', index=False)

    except Exception as e:
        sys.exit(f"Error exporting to Excel: {e}")


def main():
    print("AWF Role Comparison Tool\n" + "=" * 25)

    # Configuration
    XML_FILE = 'AWF_01_accounts.xml'
    EXCEL_FILE = 'AWF_List.xlsx'
    OUTPUT_FILE = 'AWF_Role_Comparison_Results.xlsx'

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
        print(f"- Users only in XML: {len(results['only_in_xml'])}")
        print(f"- Users only in Excel: {len(results['only_in_excel'])}")
        print(f"- Users with matching roles: {results['matching_users']}")
        print(f"- Users with role mismatches: {len(results['role_mismatches'])}")
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