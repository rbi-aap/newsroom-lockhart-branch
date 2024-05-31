import superdesk
from .resource import NewsAPISyndicateResource
from .service import NewsAPISyndicateService


def init_app(app):
    superdesk.register_resource('news/syndicate', NewsAPISyndicateResource, NewsAPISyndicateService, _app=app)
