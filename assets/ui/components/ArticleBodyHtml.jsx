import React from 'react';
import PropTypes from 'prop-types';
import {get, memoize} from 'lodash';
import {formatHTML} from 'utils';
import {connect} from 'react-redux';
import {selectCopy} from '../../wire/actions';
import DOMPurify from 'dompurify';

/**
 * using component to fix iframely loading
 * https://iframely.com/docs/reactjs
 */
class ArticleBodyHtml extends React.PureComponent {
    constructor(props) {
        super(props);
        this.state = {
            sanitizedHtml: ''
        };
        this.copyClicked = this.copyClicked.bind(this);
        this.clickClicked = this.clickClicked.bind(this);
        this.preventContextMenu = this.preventContextMenu.bind(this);

        // use memoize so this function is only called when `body_html` changes
        this.getBodyHTML = memoize(this._getBodyHTML.bind(this));
        this.bodyRef = React.createRef();
    }

    componentDidMount() {
        this.updateSanitizedHtml();
        this.loadIframely();
        this.executeScripts();
        document.addEventListener('copy', this.copyClicked);
        document.addEventListener('click', this.clickClicked);
        this.addContextMenuEventListeners();
    }

    clickClicked(event) {
        if (event != null) {
            const target = event.target;
            if (target && target.tagName === 'A' && this.isLinkExternal(target.href)) {
                event.preventDefault();
                event.stopPropagation();

                const nextWindow = window.open(target.href, '_blank', 'noopener');

                if (nextWindow) {
                    nextWindow.opener = null;
                }
            }
        }
    }

    isLinkExternal(href) {
        try {
            const url = new URL(href);

            // Check if the hosts are different and protocol is http or https
            return url.host !== window.location.host && ['http:', 'https:'].includes(url.protocol);
        } catch (e) {
            // will throw if string is not a valid link
            return false;
        }
    }

    componentDidUpdate(prevProps) {
        if (prevProps.item !== this.props.item) {
            this.updateSanitizedHtml();
        }
        this.loadIframely();
        this.executeScripts();
        this.addContextMenuEventListeners();
    }

    updateSanitizedHtml() {
        const item = this.props.item;
        const html = this.getBodyHTML(
            get(item, 'es_highlight.body_html.length', 0) > 0 ?
                item.es_highlight.body_html[0] :
                item.body_html
        );
        this.sanitizeHtml(html);
    }

    sanitizeHtml(html) {
        if (!html) {
            this.setState({ sanitizedHtml: '' });
            return;
        }
        const sanitizedHtml = DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe'],
            ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'src', 'width', 'height'],
            ALLOW_DATA_ATTR: true
        });
        this.setState({ sanitizedHtml });
    }

    loadIframely() {
        const html = get(this.props, 'item.body_html', '');

        if (window.iframely && html && html.includes('iframely')) {
            window.iframely.load();
        }
    }

    executeScripts() {
        const tree = this.bodyRef.current;
        const loaded = [];

        if (tree == null) {
            return;
        }

        tree.querySelectorAll('script').forEach((s) => {
            if (s.hasAttribute('src') && !loaded.includes(s.getAttribute('src'))) {
                let url = s.getAttribute('src');

                // Check if the URL starts with 'https://' or 'http://'
                if (url.startsWith('https://') || url.startsWith('http://')) {
                    loaded.push(url);

                    // Check for specific platform URLs and corresponding global objects
                    if (url.includes('twitter.com/') && window.twttr != null) {
                        window.twttr.widgets.load();
                        return;
                    }

                    if (url.includes('instagram.com/') && window.instgrm != null) {
                        window.instgrm.Embeds.process();
                        return;
                    }

                    // Force Flourish to always load
                    if (url.includes('flourish.studio/')) {
                        delete window.FlourishLoaded;
                    }

                    if (url.startsWith('http')) {
                        // Change https?:// to // so it uses the schema of the client
                        url = url.substring(url.indexOf(':') + 1);
                    }

                    const script = document.createElement('script');
                    script.src = url;
                    script.async = true;

                    script.onload = () => {
                        document.body.removeChild(script);
                    };

                    script.onerror = (error) => {
                        throw new URIError('The script ' + error.target.src + ' didn\'t load.');
                    };

                    document.body.appendChild(script);
                } else {
                    console.warn('stop loading insecure script:', url);
                }
            }
        });
    }

    copyClicked() {
        this.props.reportCopy(this.props.item);
    }

    componentWillUnmount() {
        document.removeEventListener('copy', this.copyClicked);
        document.removeEventListener('click', this.clickClicked);
        this.removeContextMenuEventListeners();
    }

    addContextMenuEventListeners() {
        const tree = this.bodyRef.current;
        if (tree) {
            tree.querySelectorAll('[data-disable-download="true"]').forEach((element) => {
                element.addEventListener('contextmenu', this.preventContextMenu);
            });
        }
    }

    removeContextMenuEventListeners() {
        const tree = this.bodyRef.current;
        if (tree) {
            tree.querySelectorAll('[data-disable-download="true"]').forEach((element) => {
                element.removeEventListener('contextmenu', this.preventContextMenu);
            });
        }
    }

    preventContextMenu(event) {
        event.preventDefault();
    }

    _getBodyHTML(bodyHtml) {
        return !bodyHtml ?
            null :
            this._updateImageEmbedSources(formatHTML(bodyHtml));
    }

    /**
     * Update Image Embeds to use the Web APIs Assets endpoint
     *
     * @param html - The `body_html` value (could also be the ES Highlight version)
     * @returns {string}
     * @private
     */
    _updateImageEmbedSources(html) {
        const item = this.props.item;

        // Get the list of Original Rendition IDs for all Image Associations
        const imageEmbedOriginalIds = Object
            .keys(item.associations || {})
            .filter((key) => key.startsWith('editor_'))
            .map((key) => get(item.associations[key], 'renditions.original.media'))
            .filter((value) => value);

        if (!imageEmbedOriginalIds.length) {
            // This item has no Image Embeds
            // return the supplied html as-is
            return html;
        }

        // Create a DOM node tree from the supplied html
        // We can then efficiently find and update the image sources
        const container = document.createElement('div');
        let imageSourcesUpdated = false;

        container.innerHTML = html;
        container
            .querySelectorAll('img,video,audio')
            .forEach((imageTag) => {
                // Using the tag's `src` attribute, find the Original Rendition's ID
                const originalMediaId = imageEmbedOriginalIds.find((mediaId) => (
                    !imageTag.src.startsWith('/assets/') &&
                    imageTag.src.includes(mediaId))
                );

                if (originalMediaId) {
                    // We now have the Original Rendition's ID
                    // Use that to update the `src` attribute to use Newshub's Web API
                    imageSourcesUpdated = true;
                    imageTag.src = `/assets/${originalMediaId}`;
                }
            });

        // Find all Audio and Video tags and mark them up for the player
        container.querySelectorAll('video, audio')
            .forEach((vTag) => {
                vTag.classList.add('js-player');
                if (vTag.getAttribute('data-disable-download')) {
                    vTag.setAttribute('data-plyr-config', '{"controls": ["play-large", "play",' +
                        '"progress", "volume", "mute", "rewind", "fast-forward", "current-time",' +
                        '"captions", "restart", "duration"]}');

                } else {
                    vTag.setAttribute('data-plyr-config', '{"controls": ["play-large", "play",' +
                        '"progress", "volume", "mute", "rewind", "fast-forward", "current-time",' +
                        '"captions", "restart", "duration", "download"], "urls": {"download": ' +
                        '"' + vTag.getAttribute('src') + '?item_id=' + item._id + '"' +
                        '}}');
                }

                imageSourcesUpdated = true;
            });

        return imageSourcesUpdated ?
            container.innerHTML :
            html;
    }

    render() {
        if (!this.state.sanitizedHtml) {
            return null;
        }

        return (
            <div
                ref={this.bodyRef}
                className='wire-column__preview__text'
                id='preview-body'
                dangerouslySetInnerHTML={{__html: this.state.sanitizedHtml}}
            />
        );
    }
}

ArticleBodyHtml.propTypes = {
    item: PropTypes.shape({
        body_html: PropTypes.string,
        _id: PropTypes.string,
        es_highlight: PropTypes.shape({
            body_html: PropTypes.arrayOf(PropTypes.string),
        }),
        associations: PropTypes.object,
    }).isRequired,
    reportCopy: PropTypes.func,
};

const mapDispatchToProps = (dispatch) => ({
    reportCopy: (item) => dispatch(selectCopy(item))
});

export default connect(null, mapDispatchToProps)(ArticleBodyHtml);
