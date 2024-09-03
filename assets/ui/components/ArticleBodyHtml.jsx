import React from 'react';
import PropTypes from 'prop-types';
import {get, memoize} from 'lodash';
import {formatHTML} from 'utils';
import {connect} from 'react-redux';
import {selectCopy} from '../../wire/actions';
import DOMPurify from 'dompurify';

const fallbackDefault = 'https://storage.googleapis.com/pw-prod-aap-website-bkt/test/aap_poster_default.jpg';

class ArticleBodyHtml extends React.PureComponent {
    constructor(props) {
        super(props);
        this.state = {
            sanitizedHtml: '',
            memoryUsage: null
        };
        this.copyClicked = this.copyClicked.bind(this);
        this.clickClicked = this.clickClicked.bind(this);
        this.preventContextMenu = this.preventContextMenu.bind(this);
        this.getBodyHTML = memoize(this._getBodyHTML.bind(this));
        this.bodyRef = React.createRef();
        this.players = new Map();
        this.memoryInterval = null;
    }

    componentDidMount() {
        this.updateSanitizedHtml();
        this.loadIframely();
        this.setupPlyrPlayers();
        this.executeScripts();
        document.addEventListener('copy', this.copyClicked);
        document.addEventListener('click', this.clickClicked);
        this.addContextMenuEventListeners();
        // this.startMemoryUsageTracking();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.item !== this.props.item) {
            this.updateSanitizedHtml();
        }
        this.loadIframely();
        this.executeScripts();
        this.setupPlyrPlayers();
        this.addContextMenuEventListeners();
    }

    componentWillUnmount() {
        document.removeEventListener('copy', this.copyClicked);
        document.removeEventListener('click', this.clickClicked);
        this.removeContextMenuEventListeners();

        this.players.forEach(player => player.destroy());
        this.players.clear();

        if (this.memoryInterval) {
            clearInterval(this.memoryInterval);
        }
    }

    startMemoryUsageTracking() {
        if (window.performance && window.performance.memory) {
            this.memoryInterval = setInterval(() => {
                const memoryInfo = window.performance.memory;
                this.setState({
                    memoryUsage: {
                        usedJSHeapSize: memoryInfo.usedJSHeapSize / (1024 * 1024),
                        totalJSHeapSize: memoryInfo.totalJSHeapSize / (1024 * 1024),
                        jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit / (1024 * 1024)
                    }
                });
            }, 2000);
        }
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
            this.setState({sanitizedHtml: ''});
            return;
        }
        const sanitizedHtml = DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe', 'video', 'audio', 'figure', 'figcaption', 'script', 'twitter-widget', 'fb:like',
                'blockquote', 'div'],
            ADD_ATTR: [
                'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'src', 'width', 'height',
                'data-plyr-config', 'data-plyr', 'aria-label', 'aria-hidden', 'focusable',
                'class', 'role', 'tabindex', 'controls', 'download', 'target',
                'async', 'defer', 'data-tweet-id', 'data-href',
                'data-instgrm-captioned', 'data-instgrm-permalink',
                'data-flourish-embed', 'data-src'
            ],
            ALLOW_DATA_ATTR: true,
            ALLOW_UNKNOWN_PROTOCOLS: true,
            KEEP_CONTENT: true
        });
        this.setState({sanitizedHtml});
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

                loaded.push(url);

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
                    // change https?:// to // so it uses schema of the client
                    url = url.substring(url.indexOf(':') + 1);
                }

                const script = document.createElement('script');

                script.src = url;
                script.async = true;

                script.onload = () => {
                    document.body.removeChild(script);
                };

                script.onerrror = (error) => {
                    throw new URIError('The script ' + error.target.src + 'didn\'t load.');
                };

                document.body.appendChild(script);
            }
        });
    }

    setupPlyrPlayers() {
        const tree = this.bodyRef.current;
        if (tree == null || window.Plyr == null) {
            return;
        }

        tree.querySelectorAll('.js-player:not(.plyr--setup)').forEach(element => {
            if (!this.players.has(element)) {
                const player = new window.Plyr(element, {
                    seekTime: 1,
                    keyboard: {focused: true, global: true},
                    tooltips: {controls: true, seek: true},
                    captions: {active: true, language: 'auto', update: true}
                });
                this.players.set(element, player);
                this.checkVideoLoading(player, element.getAttribute('src'));
                this.setupMovePlayback(player);
            }
        });
    }

    setupMovePlayback(player) {
        const container = player.elements.container;
        let isScrubbing = false;
        let wasPaused = false;

        container.addEventListener('mousedown', startScrubbing);
        document.addEventListener('mousemove', scrub);
        document.addEventListener('mouseup', stopScrubbing);

        function startScrubbing(event) {
            if (event.target.closest('.plyr__progress')) {
                isScrubbing = true;
                wasPaused = player.paused;
                player.pause();
                scrub(event);
            }
        }

        function scrub(event) {
            if (!isScrubbing) return;

            const progress = player.elements.progress;
            const rect = progress.getBoundingClientRect();
            const percent = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
            player.currentTime = percent * player.duration;
        }

        function stopScrubbing() {
            if (isScrubbing) {
                isScrubbing = false;
                if (!wasPaused) {
                    player.play();
                }
            }
        }

    }

    checkVideoLoading(player, videoSrc) {
        if (!videoSrc || !videoSrc.startsWith('/assets/')) {
            return;
        }


        const loadHandler = () => {
            if (player.media.videoWidth === 0 && player.media.videoHeight === 0) {
                if (!player.poster) {
                    player.poster = fallbackDefault;
                }
            } else {
                const isFirstFrameBlack = player.media.videoWidth === 1920 && player.media.videoHeight === 1080;
                if (!isFirstFrameBlack)
                    if (!player.poster) {
                        player.poster = fallbackDefault;
                    }
            }
            player.off('loadeddata', loadHandler);
        };

        player.on('loadeddata', loadHandler);

    }


    _getBodyHTML(bodyHtml) {
        return !bodyHtml ?
            null :
            this._updateImageEmbedSources(formatHTML(bodyHtml));
    }

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
        // If Image tags were not updated, then return the supplied html as-is
        return imageSourcesUpdated ?
            container.innerHTML :
            html;
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
            return url.host !== window.location.host && ['http:', 'https:'].includes(url.protocol);
        } catch (e) {
            return false;
        }
    }

    copyClicked() {
        this.props.reportCopy(this.props.item);
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

    render() {
        if (!this.state.sanitizedHtml) {
            return null;
        }

        return (
            <div>
                <div
                    ref={this.bodyRef}
                    className='wire-column__preview__text'
                    id='preview-body'
                    dangerouslySetInnerHTML={{__html: this.state.sanitizedHtml}}
                />
            </div>
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
