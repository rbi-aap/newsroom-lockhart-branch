import React from 'react';
import PropTypes from 'prop-types';
import {isEmpty} from 'lodash';
import { gettext, shortDate, fullDate } from 'utils';

function CardMeta({wordCount, pictureAvailable, source, versioncreated, displayDivider, slugline ,audio, video}) {
    return (<div className="wire-articles__item__meta">
        <div className="wire-articles__item__icons">
            <span className="wire-articles__item__icon">
                <i className="icon--text icon--gray-light"></i>
            </span>
            {pictureAvailable && <span className="wire-articles__item__icon">
                <i className="icon--photo icon--gray-light">
                </i>
            </span>}
            {!isEmpty(audio) &&
                <span className='wire-articles__item__icon'>
                    <i className='icon--video icon--gray-light'></i>
                </span>
            }
            {!isEmpty(video) &&
                <span className='wire-articles__item__icon'>
                    <i className='icon--audio icon--gray-light'></i>
                </span>
            }
            {displayDivider && <span className='wire-articles__item__divider'></span>}
        </div>
        <div className="wire-articles__item__meta-info">
            {slugline && <span className='bold'>{slugline}</span>}
            <span>
                {source && `${source} // `}
                <span>{wordCount}</span> {gettext('words')}
                {versioncreated && ' // '}
                {versioncreated &&
                    <time dateTime={fullDate(versioncreated)}>{shortDate(versioncreated)}</time>
                }
            </span>
        </div>
    </div>);
}

CardMeta.propTypes = {
    wordCount: PropTypes.number,
    pictureAvailable: PropTypes.bool,
    source: PropTypes.string,
    versioncreated: PropTypes.string,
    displayDivider: PropTypes.bool,
    slugline: PropTypes.string,
    audio: PropTypes.array,
    video: PropTypes.array
};

CardMeta.defaultProps = {
    displayDivider: false,
    audio: [],
    video: [],
};

export default CardMeta;
