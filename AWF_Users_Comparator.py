import xml.etree.ElementTree as ET
import pandas as pd
from collections import defaultdict
import sys
from datetime import datetime


def parse_xml(xml_file):
    """Parse XML file and extract all user IDs."""
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        xml_users = set()

        for account in root.findall('.//account'):
            user_id = account.get('id')
            if user_id:  # Only add non-empty user IDs
                xml_users.add(user_id)
        return xml_users

    except ET.ParseError as e:
        sys.exit(f"Error parsing XML file: {e}")
    except Exception as e:
        sys.exit(f"Unexpected error reading XML: {e}")


def parse_excel(excel_file):
    """Parse Excel file and extract all user IDs with ACF2ID/NOVELLID mapping."""
    try:
        # Read ACF2ID to NOVELLID mapping sheet
        id_map_df = pd.read_excel(excel_file, sheet_name='AWF_ACF2IDNOVELL', header=5, usecols="C:D")
        id_map = {}
        if not id_map_df.empty:
            # Clean data - remove any rows with empty values
            id_map_df = id_map_df.dropna()
            id_map = dict(zip(id_map_df['ACF2ID'].astype(str).str.strip(),
                              id_map_df['NOVELLID'].astype(str).str.strip()))
        reverse_id_map = {v: k for k, v in id_map.items()}

        # Sheets to process (including AWFEMPLOYEE which appears to be the main sheet now)
        sheets_to_check = [
            'AWFEMPLOYEE', 'AWF_USERS', 'AWF_USERACCESSPROFILE'
        ]

        excel_users = set()

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

                # Clean and add all User_IDs from this sheet
                valid_users = df[user_col].dropna().astype(str).str.strip()
                excel_users.update(valid_users[valid_users != ''])

            except Exception as e:
                print(f"Warning: Error processing {sheet} sheet - {str(e)}")
                continue

        return {
            'excel_users': excel_users,
            'id_map': id_map,
            'reverse_id_map': reverse_id_map
        }

    except ImportError:
        sys.exit("Error: Missing required package 'openpyxl'. Please install with:\npip install openpyxl")
    except FileNotFoundError:
        sys.exit(f"Error: Excel file '{excel_file}' not found")
    except Exception as e:
        sys.exit(f"Error reading Excel file: {str(e)}")


def compare_users(xml_users, excel_data):
    """Compare user IDs between XML and Excel, handling ID mappings."""
    excel_users = excel_data['excel_users']
    id_map = excel_data['id_map']
    reverse_id_map = excel_data['reverse_id_map']

    # Find all possible Excel user IDs (including mapped ones)
    all_excel_ids = set(excel_users)
    for excel_user in excel_users:
        if excel_user in id_map:
            all_excel_ids.add(id_map[excel_user])
        if excel_user in reverse_id_map:
            all_excel_ids.add(reverse_id_map[excel_user])

    # Find users only in XML (considering ID mappings)
    only_in_xml = set()
    for xml_user in xml_users:
        # Check if this XML user exists in Excel (direct or mapped)
        if (xml_user not in excel_users and
                xml_user not in reverse_id_map and
                xml_user not in id_map.values()):
            only_in_xml.add(xml_user)

    # Find users only in Excel (not in XML, considering ID mappings)
    only_in_excel = set()
    for excel_user in excel_users:
        # Check if this Excel user exists in XML (direct or mapped)
        if (excel_user not in xml_users and
                excel_user not in id_map and
                excel_user not in reverse_id_map.values()):
            only_in_excel.add(excel_user)

    # Find mapped users (ACF2ID <-> NOVELLID relationships)
    mapped_users = []
    for acf2id, novellid in id_map.items():
        if acf2id in excel_users and novellid in xml_users:
            mapped_users.append(f"{acf2id} (Excel) ↔ {novellid} (XML)")

    return {
        'only_in_xml': sorted(only_in_xml),
        'only_in_excel': sorted(only_in_excel),
        'mapped_users': mapped_users,
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
                    'Users only in XML',
                    'Users only in Excel'
                ],
                'Value': [
                    datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    results['total_xml_users'],
                    results['total_excel_users'],
                    results['total_mapped_pairs'],
                    len(results['only_in_xml']),
                    len(results['only_in_excel'])
                ]
            }
            pd.DataFrame(summary_data).to_excel(writer, sheet_name='Summary', index=False)

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
    print("AWF User ID Comparison Tool\n" + "=" * 30)

    # Configuration
    XML_FILE = 'AWF_01_accounts.xml'
    EXCEL_FILE = 'AWF_List.xlsx'
    OUTPUT_FILE = 'AWF_User_Comparison_Results.xlsx'

    try:
        # Process files
        print("\n[1/3] Parsing XML file...")
        xml_users = parse_xml(XML_FILE)

        print("[2/3] Parsing Excel file...")
        excel_data = parse_excel(EXCEL_FILE)

        print("[3/3] Comparing user IDs...")
        results = compare_users(xml_users, excel_data)

        # Display quick summary
        print("\nComparison Results:")
        print(f"- Total XML users: {results['total_xml_users']}")
        print(f"- Total Excel users: {results['total_excel_users']}")
        print(f"- Mapped user pairs (ACF2ID ↔ NOVELLID): {results['total_mapped_pairs']}")
        print(f"- Users only in XML: {len(results['only_in_xml'])}")
        print(f"- Users only in Excel: {len(results['only_in_excel'])}")

        # Export results
        print(f"\nExporting results to {OUTPUT_FILE}...")
        export_results(results, OUTPUT_FILE)
        print("Done! Results exported successfully.")
    except Exception as e:
        print(f"\nError: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()