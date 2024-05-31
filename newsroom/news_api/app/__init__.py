import os
import logging
import jinja2
import flask
import json
from werkzeug.exceptions import HTTPException
from superdesk.errors import SuperdeskApiError
from collections import defaultdict
from newsroom.factory import NewsroomApp
from newsroom.news_api.api_tokens import CompanyTokenAuth
from superdesk.utc import utcnow
from newsroom.template_filters import (
    datetime_short, datetime_long, time_short, date_short,
    plain_text, word_count, char_count, date_header
)
from flask import request, make_response, jsonify, Config

from newsroom.news_api.news.syndicate.service import NewsAPISyndicateService
from typing import Dict, Union, Mapping, Optional

logger = logging.getLogger(__name__)

API_DIR = os.path.abspath(os.path.dirname(__file__))


class NewsroomNewsAPI(NewsroomApp):
    AUTH_SERVICE = CompanyTokenAuth

    def __init__(self, import_name=__package__, config=None, **kwargs):
        if not getattr(self, 'settings'):
            self.settings = Config('.')

        super(NewsroomNewsAPI, self).__init__(import_name=import_name, config=config, **kwargs)

        template_folder = os.path.abspath(os.path.join(API_DIR, '../../templates'))

        self.add_template_filter(datetime_short)
        self.add_template_filter(datetime_long)
        self.add_template_filter(date_header)
        self.add_template_filter(plain_text)
        self.add_template_filter(time_short)
        self.add_template_filter(date_short)
        self.add_template_filter(word_count)
        self.add_template_filter(char_count)
        self.jinja_loader = jinja2.ChoiceLoader([
            jinja2.FileSystemLoader(template_folder),
        ])

    def load_app_config(self):
        super(NewsroomNewsAPI, self).load_app_config()
        self.config.from_object('newsroom.news_api.settings')
        self.config.from_envvar('NEWS_API_SETTINGS', silent=True)

    def run(self, host=None, port=None, debug=None, **options):
        if not self.config.get('NEWS_API_ENABLED', False):
            raise RuntimeError('News API is not enabled')

        super(NewsroomNewsAPI, self).run(host, port, debug, **options)

    def setup_error_handlers(self):
        def json_error(err):
            return flask.jsonify(err), err['code']

        def handle_werkzeug_errors(err):
            return json_error({
                'error': str(err),
                'message': getattr(err, 'description', 'An error occurred'),
                'code': getattr(err, 'code') or 500
            })

        def superdesk_api_error(err):
            return json_error({
                'error': err.message or '',
                'message': err.payload,
                'code': err.status_code or 500,
            })

        def assertion_error(err):
            return json_error({
                'error': err.args[0] if err.args else 1,
                'message': str(err),
                'code': 400
            })

        def base_exception_error(err):
            if err.error == 'search_phase_execution_exception':
                return json_error({
                    'error': 1,
                    'message': 'Invalid search query',
                    'code': 400
                })

            return json_error({
                'error': err.args[0] if err.args else 1,
                'message': str(err),
                'code': 500
            })

        for cls in HTTPException.__subclasses__():
            self.register_error_handler(cls, handle_werkzeug_errors)

        self.register_error_handler(SuperdeskApiError, superdesk_api_error)
        self.register_error_handler(AssertionError, assertion_error)
        self.register_error_handler(Exception, base_exception_error)


def create_app(config=None):
    app = NewsroomNewsAPI(__name__, config=config)

    def convert_to_syndicate(data, token, formatter):
        # remove token paramerters from requirments
        if formatter and formatter == 'ATOM':
            return NewsAPISyndicateService.generate_atom_feed(data)
        elif formatter and formatter == 'RSS':
            return NewsAPISyndicateService.generate_rss_feed(data)
        elif formatter and formatter == 'JSON':
            return jsonify(data)
        else:
            raise ValueError("Invalid formatter specified")

    def handle_unsupported_format(data, token, formatter):
        error_message = f"Unsupported formatter: {formatter}"
        error_response = make_response(jsonify({'error': error_message}), 400)
        return process_error_response(error_response)

    FORMAT_HANDLERS = defaultdict(
        lambda: {'handler': handle_unsupported_format, 'content_type': 'application/json'},
        {
            'ATOM': {'handler': convert_to_syndicate, 'content_type': 'application/xml'},
            'RSS': {'handler': convert_to_syndicate, 'content_type': 'application/xml'},
            'JSON': {'handler': convert_to_syndicate, 'content_type': 'application/json'},
        }
    )

    @app.after_request
    def process_response(response):
        if 'news/syndicate' in request.url:
            if response.status_code >= 400:
                return process_error_response(response)

            format_param = request.args.get('formatter')
            if format_param:
                format_param = format_param.upper().strip()
                try:
                    format_handler = FORMAT_HANDLERS.get(format_param)
                    if format_handler:
                        token = get_auth_token()
                        response_data = get_response_data(response)
                        response = format_handler['handler'](response_data, token, format_param)
                    else:
                        error_message = f"Unsupported formatter: {format_param}"
                        error_response = make_response(jsonify({'error': error_message}), 400)
                        return process_error_response(error_response)
                except ValueError as e:
                    error_message = f"An error occurred in converting response to {format_param}: {e}"
                    error_response = make_response(jsonify({'error': error_message}), 400)
                    return process_error_response(error_response)

        # Unconditionally add rate limit headers
        add_rate_limit_headers(response)
        return response

    def get_auth_token() -> Optional[str]:
        token = request.args.get('token')
        if token:
            return token
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            return auth_header[len('Bearer '):]
        return request.headers.get('token')

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

    def add_rate_limit_headers(response):
        if flask.g.get('rate_limit_requests'):
            remaining = app.config.get('RATE_LIMIT_REQUESTS') - flask.g.get('rate_limit_requests')
            response.headers.add('X-RateLimit-Remaining', remaining)
            response.headers.add('X-RateLimit-Limit', app.config.get('RATE_LIMIT_REQUESTS'))

            if flask.g.get('rate_limit_expiry'):
                reset_time = (flask.g.get('rate_limit_expiry') - utcnow()).seconds
                response.headers.add('X-RateLimit-Reset', reset_time)

    def process_error_response(response):
        error_message: Union[bytes, str] = response.data.decode(
            'utf-8') if response.data else 'error message empty,contact admin for log information'

        def syndicate_examples():
            return {
                'json': f"{request.url_root}news/syndicate?formatter=json",
                'atom': f"{request.url_root}news/syndicate?formatter=atom",
                'rss': f"{request.url_root}news/syndicate?formatter=rss"
            }

        def syndicate_parameters():
            return {
                'format': "Specifies the desired format of the response. Accepts 'json', 'atom', or 'rss' unitl now."
            }

        error_payload: Dict[str, Dict[str, Union[int, str, Dict[str, str], Mapping[str, str]]]] = {
            "error": {
                "code": response.status_code,
                "message": error_message,
            },
            "usage": {
                "endpoint": str(request.url),
                "method": request.method,
                "description": "This API endpoint allows you to retrieve news items in different formats (JSON, ATOM, RSS).",
                "parameters": syndicate_examples(),
                "examples": syndicate_parameters(),
            },
        }
        return jsonify(error_payload)

    return app


app = create_app()

if __name__ == '__main__':
    host = '0.0.0.0'
    port = int(os.environ.get('APIPORT', '5400'))
    app.run(host=host, port=port, debug=True, use_reloader=True)
