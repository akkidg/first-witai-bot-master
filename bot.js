'use strict';

const getWit = () => {
	return new Wit(Config.WIT_TOKEN, actions);	
};

exports.getWit = getWit;


