"""
Superdesk Newsroom
==================

:license: GPLv3
"""

import superdesk
from superdesk import register_resource  # noqa
from newsroom.user_roles import UserRole

# reuse content api dbs
MONGO_PREFIX = 'CONTENTAPI_MONGO'
ELASTIC_PREFIX = 'CONTENTAPI_ELASTICSEARCH'


class Resource(superdesk.Resource):
    mongo_prefix = MONGO_PREFIX
    elastic_prefix = ELASTIC_PREFIX

    # by default make resources available to internal users/administrators
    allowed_roles = [UserRole.ADMINISTRATOR, UserRole.INTERNAL, UserRole.ACCOUNT_MANAGEMENT]
    allowed_item_roles = [UserRole.ADMINISTRATOR, UserRole.INTERNAL, UserRole.ACCOUNT_MANAGEMENT]

    def __init__(self, endpoint_name, app, service, endpoint_schema=None):
        super().__init__(endpoint_name, app, service, endpoint_schema)
        config = app.config["DOMAIN"][endpoint_name]
        config.update(
            {
                "allowed_roles": [role.value for role in self.allowed_roles],
                "allowed_item_roles": [role.value for role in self.allowed_item_roles],
            }
        )


class Service(superdesk.Service):
    pass
