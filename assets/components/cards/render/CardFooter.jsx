import React from 'react';
import PropTypes from 'prop-types';
import CardMeta from './CardMeta';

function CardFooter({wordCount, pictureAvailable, source, versioncreated, audioAvailable, videoAvailable}) {
    return (<div className="card-footer">
        <CardMeta
            audio={audioAvailable}
            video={videoAvailable}
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
    audioAvailable: PropTypes.array,
    videoAvailable: PropTypes.array,
};
CardFooter.defaultProps = {
    audioAvailable: [],
    videoAvailable: [],
};

export default CardFooter;
