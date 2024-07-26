from newsroom.auth import get_user
from newsroom.companies import get_user_company
from newsroom.products.products import get_products_by_company
from flask import request


class PermissionMedia:
    @staticmethod
    def permission_editor_in_item(item):
        user = get_user(required=True)
        company = get_user_company(user)

        if company is None:
            return []

        permitted_products = [p.get('sd_product_id') for p in
                              get_products_by_company(company.get('_id'), None, request.args.get('type', 'wire'))
                              if p.get('sd_product_id')]

        disable_download = []
        for key, embed_item in item.get("associations", {}).items():
            if key.startswith("editor_") and embed_item and embed_item.get('type') in ['audio', 'video', 'picture']:
                embed_products = [p.get('code') for p in
                                  ((item.get('associations') or {}).get(key) or {}).get('products', [])]

                if not set(embed_products) & set(permitted_products):
                    disable_download.append(key)

        return disable_download
