from newsroom.auth import get_user
from newsroom.wire.block_media.company_factory import CompanyFactory
from newsroom.wire.block_media.filter_media import get_allowed_tags
from newsroom.wire.block_media.permission_media import PermissionMedia

from lxml import html as lxml_html
import re
import logging
logger = logging.getLogger(__name__)


def filter_items_download(func):
    def wrapper(_ids, item_type, filter_func=None):
        items = func(_ids, item_type)
        if filter_func and items and ( item_type != 'agenda'):
            items = filter_func(items)
        return items
    return wrapper


def block_items_by_embedded_data(items):
    def remove_editors_media(item, allowed_tags):
        associations = item.get("associations")
        if associations:
            editors_to_remove = []
            allowed_tags = ['picture' if tag == 'img' else tag for tag in allowed_tags]
            for key, value in associations.items():
                if key.startswith("editor_") and ((value and value.get("type") not in allowed_tags)):
                    editors_to_remove.append(key)

            for editor in editors_to_remove:
                associations.pop(editor, None)

            # disable_downloads = PermissionMedia.permission_editor_in_item(item)

            # if disable_downloads:
            #     for disable_download in disable_downloads:
            #         if disable_download in associations:
            #             associations.pop(disable_download)
            item["associations"] = associations
        return item

    download_social_tag = False
    user = get_user(required=True)
    embedded_data = CompanyFactory.get_embedded_data(user)
    embedded_tags = get_allowed_tags(embedded_data)
    allowed_tags = embedded_tags['download_tags']
    if 'all' in allowed_tags or (not any(allowed_tags)):
        allowed_tags = ['video', 'audio', 'img', 'social_media']
        download_social_tag = True
    if 'social_media' in allowed_tags:
        download_social_tag = True
    filtered_items = []
    for item in items:
        html_updated = False
        root_elem = lxml_html.fromstring(item.get('body_html', ''))

        if allowed_tags:
            tag_map = {'video': 'Video', 'audio': 'Audio', 'img': 'Image', 'social_media': 'social_media'}
            excluded_tags = set(tag_map.keys()) - set(allowed_tags)
            regex_parts = [tag_map[tag] for tag in excluded_tags]
            regex = rf" EMBED START (?:{'|'.join(regex_parts)}) {{id: \"editor_([0-9]+)"
            comments = root_elem.xpath('//comment()')
            for comment in comments:
                m = re.search(regex, comment.text)
                if m and m.group(1):
                    figure = comment.getnext()
                    for elem in figure.iterchildren():
                        if (elem.tag in excluded_tags
                            and ('data-disable-download' not in elem.attrib
                                 or elem.attrib['data-disable-download'] != 'true')):
                            elem.attrib['data-disable-download'] = 'true'
                            html_updated = True
                            break
        if not download_social_tag:
            social_media_embeds = root_elem.xpath('//div[@class="embed-block"]')
            for social_media_embed in social_media_embeds:
                if 'disabled-embed' not in social_media_embed.attrib.get('class', ''):
                    social_media_embed.attrib['class'] = social_media_embed.attrib.get('class', '') + ' disabled-embed'
                blockquote_elements = social_media_embed.xpath('.//blockquote')
                for blockquote in blockquote_elements:
                    if 'data-disable-download' not in blockquote.attrib:
                        blockquote.attrib['data-disable-download'] = 'true'
                    html_updated = True
                    break

        if html_updated:
            for elem in root_elem.xpath('//*[@data-disable-download="true"]'):
                elem.getparent().remove(elem)
            item["body_html"] = lxml_html.tostring(root_elem, encoding='unicode', method="html")

        item_remove = remove_editors_media(item, allowed_tags)
        filtered_items.append(item_remove)

    return filtered_items
