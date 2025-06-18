# This is a sample Python script.

# Press Shift+F10 to execute it or replace it with your code.
# Press Double Shift to search everywhere for classes, files, tool windows, actions, and settings.
import xml.etree.ElementTree as ET
import pandas as pd
from collections import defaultdict


def parse_xml(xml_file):
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


def parse_excel(excel_file):
    # Read scheduling sheet
    sched_df = pd.read_excel(excel_file, sheet_name='Scheduling')
    sched_users = set(sched_df['User_ID'].tolist())

    # Read onrequest sheet
    onreq_df = pd.read_excel(excel_file, sheet_name='OnRequest')
    onreq_users = set(onreq_df['User_ID'].tolist())

    return sched_users, onreq_users


def compare_data(xml_users, sched_users, onreq_users):
    xml_user_ids = set(xml_users.keys())
    excel_user_ids = sched_users.union(onreq_users)

    # User presence differences
    only_in_xml = xml_user_ids - excel_user_ids
    only_in_excel = excel_user_ids - xml_user_ids

    # Role validation for common users
    role_mismatches = []
    common_users = xml_user_ids.intersection(excel_user_ids)

    results = []
    for user in common_users:
        # Check scheduling roles
        has_sched_in_xml = any(role.startswith('SCHEDULING_') for role in xml_users[user])
        in_sched_excel = user in sched_users

        # Check onrequest roles
        has_onreq_in_xml = 'AWF_OnRequest User' in xml_users[user]
        in_onreq_excel = user in onreq_users

        results.append({
            'User_ID': user,
            'XML_Scheduling_Roles': [r for r in xml_users[user] if r.startswith('SCHEDULING_')],
            'In_Excel_Scheduling': in_sched_excel,
            'Scheduling_Match': has_sched_in_xml == in_sched_excel,
            'XML_OnRequest_Role': 'AWF_OnRequest User' in xml_users[user],
            'In_Excel_OnRequest': in_onreq_excel,
            'OnRequest_Match': has_onreq_in_xml == in_onreq_excel
        })

    return {
        'only_in_xml': only_in_xml,
        'only_in_excel': only_in_excel,
        'role_comparison': pd.DataFrame(results)
    }


# Usage
xml_data = parse_xml('AWF_01_accounts.xml')
sched_users, onreq_users = parse_excel('TEstAWF_List.xlsx')
results = compare_data(xml_data, sched_users, onreq_users)

# Display results
print("Users only in XML:", results['only_in_xml'])
print("Users only in Excel:", results['only_in_excel'])
print("\nRole comparison:")
print(results['role_comparison'].to_string())
