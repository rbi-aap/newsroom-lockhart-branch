import bcrypt
from flask import current_app as app, session

import newsroom
import superdesk
from flask import request
from content_api import MONGO_PREFIX
from superdesk.utils import is_hashed, get_hash
from newsroom.auth import get_user, get_user_id, SessionAuth
from newsroom.utils import set_original_creator, set_version_creator
from newsroom.user_roles import UserRole


class UserAuthentication(SessionAuth):
    def authorized(self, allowed_roles, resource, method):
        if super().authorized(allowed_roles, resource, method):
            return True

        if not get_user_id():
            return False

        if not request.view_args or not request.view_args.get("_id"):
            # not a request for a specific user, stop
            return False

        if request.view_args["_id"] == str(get_user_id()):
            # current user editing current user
            return True

        current_user = get_user()
        if not current_user.get("company") or current_user.get("user_type") != UserRole.COMPANY_ADMIN.value:
            # current user not a company admin
            return False

        request_user = superdesk.get_resource_service("users").find_one(req=None, _id=request.view_args["_id"])
        if request_user.get("company") and request_user["company"] == current_user["company"]:
            # if current user is a company admin for request user
            return True

        return False


class UsersResource(newsroom.Resource):
    """
    Users schema
    """

    authentication = UserAuthentication()

    schema = {
        'password': {
            'type': 'string',
            'minlength': 8
        },
        'first_name': {
            'type': 'string'
        },
        'last_name': {
            'type': 'string'
        },
        'email': {
            'unique': True,
            'type': 'string',
            'required': True
        },
        'phone': {
            'type': 'string',
            'nullable': True
        },
        'mobile': {
            'type': 'string',
            'nullable': True
        },
        'role': {
            'type': 'string',
            'nullable': True
        },
        'signup_details': {
            'type': 'dict'
        },
        'country': {
            'type': 'string'
        },
        'company': newsroom.Resource.rel('companies', embeddable=True, required=False),
        'user_type': {
            'type': 'string',
            'allowed': ['administrator', 'internal', 'public', 'account_management'],
            'default': 'public'
        },
        'is_validated': {
            'type': 'boolean',
            'default': False
        },
        'is_enabled': {
            'type': 'boolean',
            'default': True
        },
        'is_approved': {
            'type': 'boolean',
            'default': False
        },
        'expiry_alert': {
            'type': 'boolean',
            'default': False
        },
        'token': {
            'type': 'string',
        },
        'token_expiry_date': {
            'type': 'datetime',
        },
        'receive_email': {
            'type': 'boolean',
            'default': True
        },
        'locale': {
            'type': 'string',
        },
        'last_active': {
            'type': 'datetime',
            'required': False,
            'nullable': True
        },
        'original_creator': newsroom.Resource.rel('users'),
        'version_creator': newsroom.Resource.rel('users'),
    }

    item_methods = ['GET', 'PATCH', 'PUT']
    resource_methods = ['GET', 'POST']
    mongo_prefix = MONGO_PREFIX
    datasource = {
        'source': 'users',
        'projection': {'password': 0, 'token': 0},
        'default_sort': [('last_name', 1)]
    }
    mongo_indexes = {
        'email': ([('email', 1)], {'unique': True})
    }


class UsersService(newsroom.Service):
    """
    A service that knows how to perform CRUD operations on the `users`
    collection.

    Serves mainly as a proxy to the data layer.
    """

    def on_create(self, docs):
        super().on_create(docs)
        for doc in docs:
            set_original_creator(doc)
            if doc.get('password', None) and not is_hashed(doc.get('password')):
                doc['password'] = self._get_password_hash(doc['password'])

    def on_update(self, updates, original):
        set_version_creator(updates)
        if 'password' in updates:
            updates['password'] = self._get_password_hash(updates['password'])

    def on_updated(self, updates, original):
        # set session locale if updating locale for current user
        if updates.get('locale') and original['_id'] == get_user_id() and updates['locale'] != original.get('locale'):
            session['locale'] = updates['locale']

    def _get_password_hash(self, password):
        return get_hash(password, app.config.get('BCRYPT_GENSALT_WORK_FACTOR', 12))

    def password_match(self, password, hashed_password):
        """Return true if the given password matches the hashed password
        :param password: plain password
        :param hashed_password: hashed password
        """
        try:
            return hashed_password == bcrypt.hashpw(password, hashed_password)
        except Exception:
            return False

    def on_deleted(self, doc):
        app.cache.delete(str(doc.get('_id')))


class AuthUserResource(newsroom.Resource):
    internal_resource = True

    schema = {
        "email": UsersResource.schema["email"],
        "password": UsersResource.schema["password"],
        "token": UsersResource.schema["token"],
        "token_expiry_date": UsersResource.schema["token_expiry_date"],
    }

    datasource = {
        "source": "users",
    }


class AuthUserService(newsroom.Service):
    pass
