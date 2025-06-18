import xml.etree.ElementTree as ET
import pandas as pd
from collections import defaultdict
import sys
from datetime import datetime


def parse_xml(xml_file):
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()

        xml_users = defaultdict(set)
        for account in root.findall('.//account'):
            user_id = account.get('id')
            roles = account.findall('.//attributeValueRef')
            for role in roles:
                role_id = role.get('id')
                if role_id.startswith('Role='):
                    xml_users[user_id].add(role_id[5:])  # Remove 'Role=' prefix
        return xml_users
    except ET.ParseError as e:
        print(f"Error parsing XML file: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error reading XML: {e}")
        sys.exit(1)


def parse_excel(excel_file):
    try:
        # Read scheduling sheet
        sched_df = pd.read_excel(excel_file, sheet_name='Scheduling')
        sched_users = set(sched_df['User_ID'].tolist())

        # Read onrequest sheet
        onreq_df = pd.read_excel(excel_file, sheet_name='OnRequest')
        onreq_users = set(onreq_df['User_ID'].tolist())

        return sched_users, onreq_users
    except ImportError:
        print("Error: Missing required package 'openpyxl'. Please install it with:")
        print("pip install openpyxl")
        sys.exit(1)
    except FileNotFoundError:
        print(f"Error: Excel file '{excel_file}' not found")
        sys.exit(1)
    except Exception as e:
        print(f"Error reading Excel file: {e}")
        sys.exit(1)


def compare_data(xml_users, sched_users, onreq_users):
    xml_user_ids = set(xml_users.keys())
    excel_user_ids = sched_users.union(onreq_users)

    # User presence differences
    only_in_xml = xml_user_ids - excel_user_ids
    only_in_excel = excel_user_ids - xml_user_ids

    # Role validation for common users
    results = []
    common_users = xml_user_ids.intersection(excel_user_ids)

    for user in common_users:
        # Check scheduling - any SCHEDULING_* role in XML counts as Scheduling
        has_sched_in_xml = any(role.startswith('SCHEDULING_') for role in xml_users[user])
        in_sched_excel = user in sched_users

        # Check onrequest roles
        has_onreq_in_xml = 'AWF_OnRequest User' in xml_users[user]
        in_onreq_excel = user in onreq_users

        # Get all scheduling roles for display
        scheduling_roles = [r for r in xml_users[user] if r.startswith('SCHEDULING_')]

        results.append({
            'User_ID': user,
            'XML_Scheduling_Roles': ', '.join(scheduling_roles) if scheduling_roles else '',
            'In_Excel_Scheduling': in_sched_excel,
            'Scheduling_Match': '✓' if has_sched_in_xml == in_sched_excel else '✗',
            'XML_OnRequest_Role': '✓' if has_onreq_in_xml else '',
            'In_Excel_OnRequest': in_onreq_excel,
            'OnRequest_Match': '✓' if has_onreq_in_xml == in_onreq_excel else '✗',
            'Has_Scheduling_In_XML': '✓' if has_sched_in_xml else '',
            'Has_OnRequest_In_XML': '✓' if has_onreq_in_xml else ''
        })

    return {
        'only_in_xml': only_in_xml,
        'only_in_excel': only_in_excel,
        'role_comparison': pd.DataFrame(results)
    }


def export_to_excel(results, output_file):
    try:
        # Create a Pandas Excel writer using openpyxl
        with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
            # Write the role comparison sheet
            results['role_comparison'].to_excel(writer, sheet_name='Role Comparison', index=False)

            # Write the users only in XML sheet
            pd.DataFrame({'Users only in XML': list(results['only_in_xml'])}).to_excel(
                writer, sheet_name='XML Only Users', index=False)

            # Write the users only in Excel sheet
            pd.DataFrame({'Users only in Excel': list(results['only_in_excel'])}).to_excel(
                writer, sheet_name='Excel Only Users', index=False)

            # Add a summary sheet
            summary_data = {
                'Comparison Date': [datetime.now().strftime('%Y-%m-%d %H:%M:%S')],
                'Total Users in XML': [len(results['only_in_xml']) + len(results['role_comparison'])],
                'Total Users in Excel': [len(results['only_in_excel']) + len(results['role_comparison'])],
                'Users only in XML': [len(results['only_in_xml'])],
                'Users only in Excel': [len(results['only_in_excel'])],
                'Common Users': [len(results['role_comparison'])],
                'Users with Scheduling in XML': [sum(1 for user in results['role_comparison'].to_dict('records') if
                                                     user['Has_Scheduling_In_XML'] == '✓')],
                'Users with OnRequest in XML': [sum(
                    1 for user in results['role_comparison'].to_dict('records') if user['Has_OnRequest_In_XML'] == '✓')]
            }
            pd.DataFrame(summary_data).to_excel(writer, sheet_name='Summary', index=False)

        print(f"\nResults successfully exported to {output_file}")
    except Exception as e:
        print(f"Error exporting to Excel: {e}")
        sys.exit(1)


def main():
    print("Starting comparison between XML and Excel files...")

    # File paths - adjust these as needed
    xml_file = 'AWF_01_accounts.xml'
    excel_file = 'AWF_List.xlsx'
    output_file = 'Comparison_Results_1.xlsx'

    # Parse files
    print("Parsing XML file...")
    xml_data = parse_xml(xml_file)

    print("Parsing Excel file...")
    sched_users, onreq_users = parse_excel(excel_file)

    # Compare data
    print("Comparing data...")
    results = compare_data(xml_data, sched_users, onreq_users)

    # Display results
    print("\n=== Results ===")
    print("\nUsers only in XML:", results['only_in_xml'])
    print("Users only in Excel:", results['only_in_excel'])

    print("\nRole comparison:")
    print(results['role_comparison'].to_string(index=False))

    # Export to Excel
    export_to_excel(results, output_file)


if __name__ == "__main__":
    main()