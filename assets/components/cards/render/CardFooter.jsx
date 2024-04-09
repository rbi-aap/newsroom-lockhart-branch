import React from 'react';
import PropTypes from 'prop-types';
import CardMeta from './CardMeta';

function CardFooter({wordCount, pictureAvailable, source, versioncreated, audioIf,videoIf }) {
    return (<div className="card-footer">
        <CardMeta
            audio={audioIf}
            video = {videoIf}
            pictureAvailable={pictureAvailable}
            wordCount={wordCount}
            source={source}
            versioncreated={versioncreated}

        />
    </div>);
}

CardFooter.propTypes = {
    wordCount: PropTypes.number,
    pictureAvailable: PropTypes.bool,
    source: PropTypes.string,
    versioncreated: PropTypes.string,
    audioIf: PropTypes.array,
    videoIf: PropTypes.array,
};
CardFooter.defaultProps = {
    audioIf: [],
    videoIf: [],
};

export default CardFooter;
