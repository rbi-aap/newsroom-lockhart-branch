import superdesk
import flask
from flask import abort, request
from newsroom.upload import ASSETS_RESOURCE
from flask_babel import gettext
import bson.errors
from werkzeug.wsgi import wrap_file
from newsroom.news_api.utils import post_api_audit
from flask import current_app as app

blueprint = superdesk.Blueprint('assets', __name__)


def init_app(app):
    superdesk.blueprint(blueprint, app)


@blueprint.route('/assets/<path:asset_id>', methods=['GET'])
def get_item(asset_id):
    auth = app.auth
    if not auth.authorized([], None, flask.request.method):
        token = request.args.get('token')
        if token:
            if not auth.check_auth(token, allowed_roles=None, resource=None, method='GET'):
                # a try for a client that is not encoding the token
                token = token.replace(' ', '+')
                if not auth.check_auth(token, allowed_roles=None, resource=None, method='GET'):
                    abort(401, gettext('Invalid token'))
        else:
            return abort(401, gettext('Invalid token'))

    item_id = request.args.get('item_id')
    if item_id:
        superdesk.get_resource_service('history').log_api_media_download(item_id, asset_id)
    try:
        media_file = flask.current_app.media.get(asset_id, ASSETS_RESOURCE)
    except bson.errors.InvalidId:
        media_file = None
    if not media_file:
        flask.abort(404)

    data = wrap_file(flask.request.environ, media_file, buffer_size=1024 * 256)
    response = flask.current_app.response_class(
        data,
        mimetype=media_file.content_type,
        direct_passthrough=True)
    response.content_length = media_file.length
    response.last_modified = media_file.upload_date
    response.set_etag(media_file.md5)
    response.make_conditional(flask.request)
    response.headers['Content-Disposition'] = 'inline'
    post_api_audit({'_items': [{'_id': asset_id}]})
    return response
