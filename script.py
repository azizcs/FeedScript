import xml.etree.ElementTree as ET
import pandas as pd
from collections import defaultdict
import sys


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
        # Check scheduling roles
        has_sched_in_xml = any(role.startswith('SCHEDULING_') for role in xml_users[user])
        in_sched_excel = user in sched_users

        # Check onrequest roles
        has_onreq_in_xml = 'AWF_OnRequest User' in xml_users[user]
        in_onreq_excel = user in onreq_users

        results.append({
            'User_ID': user,
            'XML_Scheduling_Roles': ', '.join(r for r in xml_users[user] if r.startswith('SCHEDULING_')),
            'In_Excel_Scheduling': in_sched_excel,
            'Scheduling_Match': '✓' if has_sched_in_xml == in_sched_excel else '✗',
            'XML_OnRequest_Role': '✓' if has_onreq_in_xml else '',
            'In_Excel_OnRequest': in_onreq_excel,
            'OnRequest_Match': '✓' if has_onreq_in_xml == in_onreq_excel else '✗'
        })

    return {
        'only_in_xml': only_in_xml,
        'only_in_excel': only_in_excel,
        'role_comparison': pd.DataFrame(results)
    }


def main():
    print("Starting comparison between XML and Excel files...")

    # File paths - adjust these as needed
    xml_file = 'AWF_01_accounts.xml'
    excel_file = 'TEstAWF_List.xlsx'

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


if __name__ == "__main__":
    main()