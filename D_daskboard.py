import requests
import json
from typing import List, Optional, Dict, Any


class DynatraceSettingsAPI:
    def __init__(self, base_url: str, api_token: str):
        """
        Initialize the Dynatrace Settings API client

        Args:
            base_url: Dynatrace environment URL (e.g., 'abc12345.live.dynatrace.com')
            api_token: Dynatrace API token with required permissions
        """
        self.base_url = base_url.rstrip('/')
        self.api_token = api_token
        self.headers = {
            'Authorization': f'Api-Token {api_token}',
            'Content-Type': 'application/json'
        }

    def get_settings_objects(
            self,
            schema_ids: Optional[List[str]] = None,
            scopes: Optional[List[str]] = None,
            external_ids: Optional[List[str]] = None,
            fields: Optional[List[str]] = None,
            next_page_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get settings objects from Dynatrace API

        Args:
            schema_ids: List of schema IDs to filter by
            scopes: List of scopes to filter by
            external_ids: List of external IDs to filter by
            fields: List of fields to include in response
            next_page_key: Pagination key for subsequent requests

        Returns:
            Dictionary containing the API response
        """
        # Construct the URL
        url = f"https://{self.base_url}/api/v2/settings/objects"

        # Prepare query parameters
        params = {}

        if next_page_key:
            params['nextPageKey'] = next_page_key
        else:
            # First page requires either schemaIds or scopes
            if schema_ids:
                params['schemaIds'] = ','.join(schema_ids)
            if scopes:
                params['scopes'] = ','.join(scopes)
            if external_ids:
                params['externalIds'] = ','.join(external_ids)

        if fields:
            params['fields'] = ','.join(fields)

        try:
            # Make the API request
            response = requests.get(
                url=url,
                headers=self.headers,
                params=params,
                timeout=30
            )

            # Check for successful response
            response.raise_for_status()

            return response.json()

        except requests.exceptions.RequestException as e:
            print(f"Error making API request: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response status: {e.response.status_code}")
                print(f"Response text: {e.response.text}")
            raise

    def get_all_settings_objects(
            self,
            schema_ids: Optional[List[str]] = None,
            scopes: Optional[List[str]] = None,
            external_ids: Optional[List[str]] = None,
            fields: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Get all settings objects with pagination handling

        Args:
            schema_ids: List of schema IDs to filter by
            scopes: List of scopes to filter by
            external_ids: List of external IDs to filter by
            fields: List of fields to include in response

        Returns:
            List of all settings objects across all pages
        """
        all_objects = []
        next_page_key = None
        page_count = 0

        while True:
            page_count += 1
            print(f"Fetching page {page_count}...")

            response = self.get_settings_objects(
                schema_ids=schema_ids,
                scopes=scopes,
                external_ids=external_ids,
                fields=fields,
                next_page_key=next_page_key
            )

            # Add objects from current page to results
            if 'items' in response:
                all_objects.extend(response['items'])

            # Check if there are more pages
            next_page_key = response.get('nextPageKey')
            if not next_page_key:
                break

        print(f"Retrieved {len(all_objects)} objects across {page_count} pages")
        return all_objects


def main():
    # Configuration - Replace these with your actual values
    BASE_URL = "your-environment.live.dynatrace.com"  # e.g., "abc12345.live.dynatrace.com"
    API_TOKEN = "your-api-token-here"  # Replace with your actual API token

    # Initialize the API client
    dynatrace_api = DynatraceSettingsAPI(BASE_URL, API_TOKEN)

    # Example 1: Get objects for specific schema IDs
    print("=== Example 1: Get objects by schema IDs ===")
    schema_objects = dynatrace_api.get_all_settings_objects(
        schema_ids=["builtin:alerting.profile", "builtin:anomaly-detection.metric-events"],
        fields=["objectId", "schemaId", "scope", "value", "externalId"]
    )

    print(f"Found {len(schema_objects)} objects for specified schemas")
    if schema_objects:
        print("First object:")
        print(json.dumps(schema_objects[0], indent=2))

    # Example 2: Get objects for specific scopes
    print("\n=== Example 2: Get objects by scopes ===")
    scope_objects = dynatrace_api.get_all_settings_objects(
        scopes=["environment", "host-ABC123"],
        fields=["objectId", "schemaId", "scope", "value"]
    )

    print(f"Found {len(scope_objects)} objects for specified scopes")

    # Example 3: Get objects with external IDs
    print("\n=== Example 3: Get objects by external IDs ===")
    external_objects = dynatrace_api.get_settings_objects(
        external_ids=["ext-id-1", "ext-id-2"],
        fields=["objectId", "schemaId", "externalId", "value"]
    )

    print(f"Found {external_objects.get('totalCount', 0)} objects for external IDs")
    if 'items' in external_objects:
        for obj in external_objects['items']:
            print(f"Object ID: {obj.get('objectId', {}).get('value')}, External ID: {obj.get('externalId')}")

    # Example 4: Get single page with limited fields
    print("\n=== Example 4: Get single page with minimal fields ===")
    single_page = dynatrace_api.get_settings_objects(
        schema_ids=["builtin:alerting.profile"],
        fields=["objectId", "schemaId"]
    )

    print(f"Page has {len(single_page.get('items', []))} objects")
    print(f"Total count: {single_page.get('totalCount', 0)}")
    print(f"Next page key: {single_page.get('nextPageKey', 'None')}")


if __name__ == "__main__":
    main()