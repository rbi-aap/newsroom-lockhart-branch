import React from 'react';
import PropTypes from 'prop-types';
import {get, memoize} from 'lodash';
import {formatHTML} from 'utils';
import {connect} from 'react-redux';
import {selectCopy} from '../../wire/actions';
import DOMPurify from 'dompurify';

const fallbackDefault = 'https://scontent.fsyd3-1.fna.fbcdn.net/v/t39.30808-6/409650761_846997544097330_4773850429743120820_n.jpg?_nc_cat=106&ccb=1-7&_nc_sid=127cfc&_nc_ohc=j6x9FL3TtcoQ7kNvgF9emTy&_nc_ht=scontent.fsyd3-1.fna&_nc_gid=ALgZM2NojeFY-L80j-LAA9M&oh=00_AYC6Y4pRTB22E1bRF1fqHDMfDpkcfNmBtIrAkRxTX08xEA&oe=66D338BF';
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
        document.addEventListener('copy', this.copyClicked);
        document.addEventListener('click', this.clickClicked);
        this.addContextMenuEventListeners();
        this.startMemoryUsageTracking();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.item !== this.props.item) {
            this.updateSanitizedHtml();
        }
        this.loadIframely();
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
                 console.log(`Playback - Current Time: ${player.currentTime.toFixed(2)}s, Duration: ${player.duration.toFixed(2)}s, Percentage: ${((player.currentTime / player.duration) * 100).toFixed(2)}%`);
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

        const startTime = Date.now();

        const loadHandler = () => {
            const loadTime = Date.now() - startTime;

            if (loadTime < 100) {
                console.log(`Media ${videoSrc} from cache. Load time: ${loadTime}ms`);
            } else {
                console.log(`Media ${videoSrc} from network server. Load time: ${loadTime}ms`);
            }

            if (player.duration > 0) {
                console.log(`Media ${videoSrc} is fully loaded. Duration: ${player.duration}s`);
            }

            if (player.media.videoWidth === 0 && player.media.videoHeight === 0) {
                console.log("Video dimensions are not available");
                if (player.poster) {
                    console.log("Poster image is already set:", player.poster);
                } else {
                    player.poster = fallbackDefault;
                    console.log("Poster image set to:", player.poster);
                }
            } else {
                console.log("Video dimensions are available");
                const isFirstFrameBlack = player.media.videoWidth === 1920 && player.media.videoHeight === 1080;
                if (isFirstFrameBlack) {
                    console.log("First frame is meaningful, Setting no fallback poster image.");
                } else if (player.poster) {
                    console.log("Poster image is set:", player.poster);
                } else {
                    console.log("No poster image is set. Setting fallback poster image.");
                    player.poster = fallbackDefault;
                }
            }
            player.off('loadeddata', loadHandler);
        };

        player.on('loadeddata', loadHandler);
        player.on('error', (error) => {
            console.error(`Error loading media ${videoSrc}:`, error);
        });
    }


    _getBodyHTML(bodyHtml) {
        return !bodyHtml ?
            null :
            this._updateImageEmbedSources(formatHTML(bodyHtml));
    }

    _updateImageEmbedSources(html) {
        const item = this.props.item;

        const imageEmbedOriginalIds = Object
            .keys(item.associations || {})
            .filter((key) => key.startsWith('editor_'))
            .map((key) => get(item.associations[key], 'renditions.original.media'))
            .filter((value) => value);

        if (!imageEmbedOriginalIds.length) {
            return html;
        }

        const container = document.createElement('div');
        let imageSourcesUpdated = false;

        container.innerHTML = html;
        container
            .querySelectorAll('img,video,audio')
            .forEach((imageTag) => {
                const originalMediaId = imageEmbedOriginalIds.find((mediaId) => (
                    !imageTag.src.startsWith('/assets/') &&
                    imageTag.src.includes(mediaId))
                );

                if (originalMediaId) {
                    imageSourcesUpdated = true;
                    imageTag.src = `/assets/${originalMediaId}`;
                }
            });

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
                {this.state.memoryUsage && (
                    <div className="memory-usage">
                        <h4>Memory Usage</h4>
                        <p>Used JS Heap: {this.state.memoryUsage.usedJSHeapSize.toFixed(2)} MB</p>
                        <p>Total JS Heap: {this.state.memoryUsage.totalJSHeapSize.toFixed(2)} MB</p>
                        <p>JS Heap Limit: {this.state.memoryUsage.jsHeapSizeLimit.toFixed(2)} MB</p>
                    </div>
                )}
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
