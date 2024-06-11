import superdesk
import logging
import json
from flask import request, make_response, jsonify
from eve.methods.get import get_internal
from .error_handlers import process_error_response
from .auth import authenticate
from .syndicate_handlers import FORMAT_HANDLERS, FEED_GENERATORS as FORMAT_HANDLERS_INIT
from .resource import NewsAPISyndicateResource
from .service import NewsAPISyndicateService
from werkzeug.routing import BaseConverter

blueprint = superdesk.Blueprint('syndicate', __name__)

logger = logging.getLogger(__name__)


class RegExConverter(BaseConverter):
    def __init__(self, map, regex='[^/]+'):
        super().__init__(map)
        self.regex = regex


def get_feed(syndicate_formatter, token=None):

    def generate_feed(syndicate_formatter):
        response = get_internal('news/search')
        return FORMAT_HANDLERS_INIT[syndicate_formatter.lower()](response[0])

    return generate_feed(syndicate_formatter)


@blueprint.route('/<regex("atom|rss"):syndicate_type>', methods=['GET'])
@blueprint.route('/<regex("atom|rss"):syndicate_type>/<path:token>', methods=['GET'])
@authenticate
def get_syndicate_feed(syndicate_type, token=None):
    return get_feed(syndicate_type, token)


def init_app(app):

    superdesk.register_resource('news/syndicate', NewsAPISyndicateResource, NewsAPISyndicateService, _app=app)
    app.url_map.converters['regex'] = RegExConverter
    superdesk.blueprint(blueprint, app)

    @app.after_request
    def process_response(response):
        if 'news/syndicate' in request.url:
            if response.status_code >= 400:
                return process_error_response(response)
            format_param = request.args.get('formatter')
            if format_param:
                format_param = format_param.upper().strip()
                try:
                    response_data = get_response_data(response)
                    response = FORMAT_HANDLERS[format_param]['handler'](response_data, format_param)
                except ValueError as e:
                    error_message = f"An error occurred in converting response to {format_param}: {e}"
                    error_response = make_response(jsonify({'error': error_message}), 400)
                    return process_error_response(error_response)
        return response

    def get_response_data(response):
        try:
            return json.loads(response.data)  # Eve response
        except (AttributeError, json.JSONDecodeError):
            try:
                return response.get_json()  # Flask response
            except (AttributeError, ValueError) as e:
                error_message = f"Unable to parse response data: {e}"
                error_response = make_response(jsonify({'error': error_message}), 400)
                return process_error_response(error_response)
