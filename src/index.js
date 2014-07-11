/** @jsx React.DOM */

var React = require('react');
var Promise = require('es6-promise').Promise;
var moment = require('moment');
var $ = require('jquery');
var _ = require('lodash');

var IndexComponent = React.createClass({
    propTypes: {
        dropboxClient: React.PropTypes.instanceOf(Dropbox.Client).isRequired,
        loadingComponent: React.PropTypes.component.isRequired,
    },
    datastore: null,
    getDefaultProps: function () {
        return {
        };
    },
    getInitialState: function () {
        return {
            selectedPodcast: null,
            selectedEpisode: null,
            podcasts: [],
            settings: null,
            deleteAllDataConfirm: false
        };
    },
    componentWillMount: function () {
        this.props.loadingComponent.start();

        var datastoreManager = this.props.dropboxClient.getDatastoreManager();
        datastoreManager.openDefaultDatastore(function (error, datastore) {
            if (error) {
                this.props.loadingComponent.stop();
                alert('Error opening default datastore: ' + error);
                return;
            }

            this.datastore = datastore;

            var podcastsTable = datastore.getTable('podcasts'),
                settingsTable = datastore.getTable('settings');

            datastore.recordsChanged.addListener(function (event) {
                var changedPodcasts = event.affectedRecordsForTable('podcasts'),
                    newPodcasts = [],
                    deletedPodcasts = [];

                _.forEach(changedPodcasts, function (podcast) {
                    if (podcast.isDeleted()) {
                        deletedPodcasts.push(podcast);
                    } else if (_.indexOf(this.state.podcasts, podcast) === -1) {
                        newPodcasts.push(podcast);
                    }
                }, this);

                if (newPodcasts.length > 0 || deletedPodcasts.length > 0) {
                    if (newPodcasts.length > 0) {
                        Array.prototype.push.apply(this.state.podcasts, newPodcasts);
                    }

                    if (deletedPodcasts.length > 0) {
                        this.state.podcasts = _.without.apply(null, [this.state.podcasts].concat(deletedPodcasts));
                    }

                    this.setState({ podcasts: this.state.podcasts }, function () {
                        this.reloadPodcasts(newPodcasts);
                    });
                } else {
                    this.forceUpdate();
                }

                console.log('records changed:', event.affectedRecordsForTable('podcasts'));
            }.bind(this));

            this.setState({
                podcasts: podcastsTable.query(),
                settings: _.first(settingsTable.query()) || settingsTable.insert({})
            }, function () {
                this.reloadPodcasts(null, function () {
                    var guid = this.state.settings.get('last_episode'),
                        podcast = null,
                        episode = null;

                    if (!guid) { return; }

                    podcast = _(this.state.podcasts).where({ episodes: [{ guid: guid }] }).first();
                    if (podcast) {
                        this.selectPodcast(podcast);

                        episode = _(podcast.episodes).where({ guid: guid }).first();
                        if (episode) {
                            this.playEpisode(episode, true);
                        }
                    }
                }.bind(this));
                this.props.loadingComponent.stop();
            });
        }.bind(this));
    },
    addPodcast: function () {
        var node = this.refs.addPodcastUrl.getDOMNode(),
            url = node.value;

        if (!url) { return; }

        this.datastore.getTable('podcasts').insert({
            url: url,
        });

        node.value = '';
    },
    deletePodcast: function (podcast) {
        if (confirm('Are you sure you want to remove the "' + podcast.title + '" podcast?')) {
            podcast.deleteRecord();

            this.setState({
                selectedPodcast: this.state.selectedPodcast === podcast ? null: this.state.selectedPodcast
            });
        }

        return false;
    },
    deleteAllData: function () {
        if (this.state.deleteAllDataConfirm) {
            if (confirm('Are you sure you want to delete ALL data?')) {
                alert('deleted');

                this.props.dropboxClient.getDatastoreManager().deleteDatastore(this.datastore.getId(), function () {
                    this.setState({
                        podcasts: [],
                        selectedPodcast: null,
                        selectedEpisode: null
                    });
                }.bind(this));
            }
            this.setState({ deleteAllDataConfirm: false });
        } else {
            this.setState({ deleteAllDataConfirm: true }, function () {
                setTimeout(function () {
                    this.setState({ deleteAllDataConfirm: false });
                }.bind(this), 5000);
            });
        }
    },
    reloadPodcasts: function (podcasts, callback) {
        var reloadList = _(podcasts || this.state.podcasts);

        if (reloadList.value().length === 0) { return; }

        this.props.loadingComponent.start();

        new Promise(function (resolve, reject) {
            $.getJSON('https://query.yahooapis.com/v1/public/yql', {
                format: 'json',
                q: 'select * from xml where ' + reloadList.map(function (podcast) {
                    return 'url = "' + podcast.get('url') + '"';
                }, this).value().join(' or ')
            })
            .done(resolve)
            .fail(function () {
                reject(Error('Invalid feed URL: ' + reloadList.pluck('url').value().join(', ')));
            });
        })
        .then(function (result) {
            if (result.query.count === 0) {
                // reloadList.invoke('deleteRecord');
                alert('Invalid feed URL: ' + reloadList.pluck('url').value().join(', '));
                return;
            }

            feeds = result.query.count === 1 ? [result.query.results.rss] : result.query.results.rss;

            var sequence = Promise.resolve();
            reloadList.forEach(function (podcast, index) {
                sequence.then(function () {
                    var feed = podcast._feed = feeds[index];

                    podcast.episodes = [];
                    podcast.positions = podcast.getOrCreateList('positions');
                    podcast.listened = podcast.getOrCreateList('listened');

                    if (!feed) { return; }

                    podcast.title = feed.channel.title;
                    if (feed.channel.image) {
                        podcast.image = _(_.isArray(feed.channel.image) ? feed.channel.image : [feed.channel.image]);
                        podcast.image = _([].concat(
                            podcast.image.pluck('url').value(),
                            podcast.image.pluck('href').value(),
                            'http://placehold.it/61x61&text=404'
                        ))
                        .filter()
                        .first();
                    } else {
                        podcast.image = 'http://placehold.it/61x61&text=404';
                    }

                    _.forEach(feed.channel.item, function (episode) {
                        episode = {
                            podcast: podcast,
                            guid: episode.guid && (episode.guid.content || episode.guid),
                            url: (episode.content || episode.enclosure || {url: ''}).url,
                            title: episode.title,
                            subtitle: (episode.subtitle || $('<div></div>').html(episode.summary).text()),
                            pubDate: moment(episode.pubDate, 'ddd, DD MMM YYYY HH:mm:ss ZZ'),
                            duration: moment.duration(("00:" + episode.duration).slice(-8)), 
                        };
                        episode.guid = episode.guid || episode.url;
                        episode.durationText = _(['days', 'hours', 'minutes', 'seconds']).map(function (unit) {
                            var count = this.get(unit);
                            return count === 0 ? false : count + ' ' + (count === 1 ? unit.slice(0, -1) : unit);
                        }, episode.duration).filter().value().slice(0, 2).join(' ');
                        podcast.episodes.push(episode);
                    });
                    podcast.episodes.sort(function (a, b) {
                        return b.pubDate - a.pubDate;
                    });
                })
                .then(undefined, function (error) {
                    alert((podcast && (podcast.title + ': ')) + error);
                });
            });
            sequence.then(function () {
                this.setState({ podcasts: this.state.podcasts });
            }.bind(this));

            return sequence;
        }.bind(this))
        .then(undefined, function (error) {
            alert(error);
        })
        .then(function () {
            this.props.loadingComponent.stop();
            callback && callback();
        }.bind(this));
    },
    selectPodcast: function (podcast) {
        this.setState({ selectedPodcast: podcast });

        return false;
    },
    playEpisode: function (episode, dontAutoPlay) {
        this.saveCurrentTime();

        this.state.settings.set('last_episode', episode.guid);

        this.setState({ selectedEpisode: episode, autoPlay: !dontAutoPlay }, function () {
            $('window, body').animate({ scrollTop: 0 }, 'slow');
        }.bind(this));
    },
    togglePauseEpisode: function () {
        var player = this.refs.player.getPlayer().getDOMNode();
        if (player.paused) {
            player.play();
        } else {
            player.pause();
            this.saveCurrentTime();
        }
    },
    toggleListened: function (episode) {
        var index = _.indexOf(episode.podcast.listened.toArray(), episode.guid);

        if (index === -1) {
            episode.podcast.listened.push(episode.guid);
        } else {
            episode.podcast.listened.remove(index);
        }
    },
    saveCurrentTime: function (callback) {
        var player = this.refs.player.getPlayer().getDOMNode();

        if (player.currentTime < 10) { 
            callback && callback();
            return;
        }

        var positions = this.state.selectedEpisode.podcast.positions,
            positionsArray = _.map(positions.toArray(), function (position) {
                return JSON.parse(position);
            }),
            index = _.findIndex(positionsArray, { guid: this.state.selectedEpisode.guid }),
            position = JSON.stringify({
                guid: this.state.selectedEpisode.guid,
                savedAt: _.now(),
                currentTime: player.currentTime
            });

        if (index === -1) {
            positions.push(position);
        } else {
            positions.set(index, position);
        }

        callback && callback();
    },
    render: function () {
        return (
            <div>
                <div className="row">
                    <div className="col-xs-12">
                        <PodcastPlayerComponent ref="player" data={this.state.selectedEpisode} save={this.saveCurrentTime} autoPlay={this.state.autoPlay} settings={this.state.settings} />
                    </div>
                </div>
                <div className="row">
                    <div className="col-xs-12 col-sm-4">
                        <PodcastListComponent data={this.state.podcasts} select={this.selectPodcast} selectedPodcast={this.state.selectedPodcast} delete={this.deletePodcast} />
                        <p>
                            <div className="input-group">
                                <input type="text" className="form-control" ref="addPodcastUrl" placeholder="Podcast RSS URL" />
                                <span className="input-group-btn">
                                    <button className="btn btn-default" type="button" onClick={this.addPodcast}>Add</button>
                                </span>
                            </div>
                        </p>
                        <p className="hidden-xs">
                            <button type="button" className="col-xs-12 btn btn-danger" onClick={this.deleteAllData}>
                                <span className="glyphicon glyphicon-trash"></span> {this.state.deleteAllDataConfirm ? 'Are you sure?' : 'Delete All Data'}
                            </button>
                        </p>
                        <hr className="visible-xs" />
                    </div>
                    <div className="col-xs-12 col-sm-8">
                        <PodcastDisplayComponent data={this.state.selectedPodcast} selectedEpisode={this.state.selectedEpisode} play={this.playEpisode} togglePause={this.togglePauseEpisode} toggleListened={this.toggleListened} delete={this.deletePodcast} settings={this.state.settings} />
                    </div>
                </div>
            </div>
        );
    }
});

var PodcastListComponent = React.createClass({
    propTypes: {
        data: React.PropTypes.array.isRequired,
        select: React.PropTypes.func.isRequired,
        delete: React.PropTypes.func.isRequired
    },
    render: function () {
        return (
            <ul className="nav nav-pills">
                {
                    _.map(this.props.data, function (podcast) {
                        if (!podcast || !podcast.listened) { return; }

                        var unreadCount = _.without.apply(null, [].concat([_.pluck(podcast.episodes, 'guid')], podcast.listened.toArray())).length,
                            badge = unreadCount > 0 ? <span className="badge pull-right">{unreadCount}</span> : '';

                        return (
                            <li className={'col-xs-5 col-sm-12 ' + (this.props.selectedPodcast === podcast ? 'active' : '')} key={podcast.get('guid')}>
                                <a className="col-xs-12" href="#" onClick={this.props.select.bind(null, podcast)}>
                                    <img className="col-xs-12 col-sm-4" src={podcast.image} />
                                    <div className="hidden-xs col-sm-8">
                                        <span>{podcast.title}</span>
                                    </div>
                                    {badge}
                                </a>
                            </li>
                        );
                    }, this)
                }
            </ul>
        );
    }
});

var PodcastDisplayComponent = React.createClass({
    propTypes: {
        data: React.PropTypes.object.isRequired,
        play: React.PropTypes.func.isRequired,
        delete: React.PropTypes.func.isRequired,
    },
    getInitialState: function () {
        return {
            showHidden: undefined,
            page: 0,
            podcast: null
        };
    },
    componentWillReceiveProps: function (props) {
        if (this.state.showHidden === undefined && props.settings) {
            this.setState({ showHidden: props.settings.get('show_hidden') });
        }
    },
    componentDidUpdate: function () {
        if (this.props.data !== this.state.podcast) {
            this.setState({
                page: 0,
                podcast: this.props.data
            });
        }
    },
    toggleShowHidden: function () {
        this.setState({ showHidden: !this.state.showHidden }, function () {
            this.props.settings.set('show_hidden', this.state.showHidden);
        });
    },
    nextPage: function () {
        this.setState({ page: this.state.page + 1 });
    },
    prevPage: function () {
        this.setState({ page: this.state.page - 1 });
    },
    render: function () {
        if (!this.props.data) {
            return (
                <div className="jumbotron text-center">
                    <h2>Select a podcast</h2>
                </div>
            );
        }

        var start = this.state.page * 10,
            end = start + 10,
            episodes = this.props.data.episodes,
            episodesOnPage = [],
            listenedArray = this.props.data.listened.toArray(),
            positions = _.map(this.props.data.positions.toArray(), function (position) {
                return JSON.parse(position);
            });

        if (!this.state.showHidden) {
            episodes = _.reject(episodes, function (episode) {
                return _.contains(listenedArray, episode.guid);
            });
        }
        episodesOnPage = episodes.slice(start, end);

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <div className="row">
                    <h3 className="panel-title col-xs-12 col-sm-7">
                         {this.props.data.title}
                    </h3>
                    <p style={{ textAlign: 'right' }} className="col-xs-12 col-sm-5">
                        <button type="button" className={'btn btn-xs btn-default ' + (listenedArray.length === 0 ? 'hidden' : 'visible')} onClick={this.toggleShowHidden}>
                            <span className="glyphicon glyphicon-check"></span> {this.state.showHidden ? 'Hide' : 'Show' } Read
                        </button>
                        <button type="button" className="btn btn-xs btn-danger" onClick={this.props.delete.bind(null, this.props.data)}>
                            <span className="glyphicon glyphicon-trash"></span> Delete Podcast
                        </button>
                    </p>
                    </div>
                </div>
                <div className="panel-body">
                    <table className="table table-hover">
                        <tbody>
                            {
                                _.map(episodesOnPage, function (episode) {
                                    var position = _.find(positions, { guid: episode.guid }),
                                        listened = _.contains(listenedArray, episode.guid),
                                        date = moment().diff(episode.pubDate, 'days') >= 7 ? episode.pubDate.format('dddd, MMM D, YYYY') : episode.pubDate.format('dddd');

                                    if (date === 'Invalid date') {
                                        date = episode.pubDate.fromNow();
                                    }

                                    if (position && position.currentTime) {
                                        episode.position = position;
                                        position = _(['hours', 'minutes', 'seconds']).map(function (unit) {
                                            return ('0' + this.get(unit)).slice(-2);
                                        }, moment.duration(position.currentTime * 1000)).value().join(':');
                                    }

                                    return (
                                        <tr key={episode.guid}>
                                            <td>
                                                <div className="col-xs-12 col-sm-3">
                                                    <span title={episode.pubDate.format('LLLL')}>{date}</span><br />
                                                    <small>{episode.durationText}</small>
                                                    <p>
                                                        <button type="button" className={'col-xs-6 col-sm-12 btn btn-success btn-sm ' + (episode !== this.props.selectedEpisode ? 'hidden' : 'visible')} onClick={this.props.togglePause}>
                                                            <span className="glyphicon glyphicon-pause"></span> Playing
                                                        </button>
                                                        <button type="button" className={'col-xs-6 col-sm-12 btn ' + (position ? 'btn-info' : 'btn-default') + ' btn-sm ' + (episode === this.props.selectedEpisode ? 'hidden' : 'visible')} onClick={this.props.play.bind(null, episode, false)}>
                                                            <span className="glyphicon glyphicon-play"></span> {position || 'Play'}
                                                        </button>
                                                        <button type="button" className={'col-xs-6 col-sm-12 btn btn-sm ' + (listened ? 'btn-warning' : 'btn-danger')} onClick={this.props.toggleListened.bind(null, episode)}>
                                                            <span className="glyphicon glyphicon-check"></span> Mark {listened ? 'Unread' : 'Read'}
                                                        </button>
                                                    </p>
                                                </div>
                                                <div className="col-xs-12 col-sm-9">
                                                    <h5>{episode.title}</h5>
                                                    <p><small>{episode.subtitle}</small></p>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }, this)
                            }
                        </tbody>
                    </table>
                    <p className={episodes.length <= 10 ? 'hidden' : 'visible'} style={{ textAlign: 'center' }}>
                        <button type="button" className={'btn btn-default ' + (this.state.page > 0 ? 'visible' : 'hidden')} onClick={this.prevPage}>Prev</button>
                        <button type="button" className={'btn btn-default ' + (end < episodes.length ? 'visible' : 'hidden')} onClick={this.nextPage}>Next</button>
                    </p>
                </div>
            </div>
        );
    }
});

var PodcastPlayerComponent = React.createClass({
    getInitialState: function () {
        return {
            player: null,
            currentTime: null,
            video: undefined,
        };
    },
    componentWillReceiveProps: function (props) {
        if (this.state.video === undefined && props.settings) {
            this.setState({ video: props.settings.get('video') });
        }
    },
    componentDidUpdate: function () {
        var player = this.getPlayer();

        if (player !== this.state.player) {
            this.setState({ player: player }, function () {
                var DOMNode = player.getDOMNode(),
                    throttle = _.throttle(this.props.save, 60 * 1000, { leading: false, trailing: true });

                $(DOMNode)
                    .on('timeupdate', function () {
                        throttle();
                    }.bind(this))
                    .on('durationchange', function () {
                        if (this.props.data.position && this.props.data.position.currentTime) {
                            DOMNode.currentTime = this.props.data.position.currentTime;
                        }
                    }.bind(this))
                    .on('ended', function () {
                        var episode = this.props.data,
                            index = _.indexOf(episode.podcast.listened.toArray(), episode.guid);

                        if (index === -1) {
                            episode.podcast.listened.push(episode.guid);
                        }
                    }.bind(this))
                    .on('pause', function () {
                        this.props.save();
                    }.bind(this));
            });
        }
    },
    toggleVideo: function () {
        this.props.save(function () {
            this.setState({ video: !this.state.video }, function () {
                this.props.settings.set('video', this.state.video);
            });
        }.bind(this));
    },
    seek: function (time) {
        var player = this.getPlayer(),
            DOMNode = player.getDOMNode();

        DOMNode.currentTime = Math.max(0, DOMNode.currentTime + time);
        this.props.save();
    },
    getPlayer: function () {
        return this.refs.player;
    },
    render: function () {
        var episode = this.props.data || {};
        _.defaults(episode, { title: 'No episode selected', pubDate: moment(0) });

        var player = (
            <audio className="col-xs-12 col-sm-12" autoPlay={this.props.autoPlay} controls src={episode.url} ref="player">
                Your browser does not support the audio element.
            </audio>
        );

        if (this.state.video) {
            player = (
                <video className="col-xs-12 col-sm-12" autoPlay={this.props.autoPlay} controls src={episode.url} ref="player">
                    Your browser does not support the video element.
                </video>
            );
        }

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <h3 className="panel-title">{episode.title}</h3>
                </div>
                <div className="panel-body">
                    <div className={'row ' + (episode.url ? 'visible' : 'hidden')}>
                        <div className="col-xs-12 col-sm-5 col-md-4">
                            <p className="row">
                                {player}
                            </p>
                            <p className="row">
                                <div className="pull-left">
                                    <button type="button" className="btn btn-default" onClick={_.partial(this.seek, -30)}>
                                        <span className="glyphicon glyphicon-backward"></span>
                                    </button>
                                    <button type="button" className="btn btn-default" onClick={_.partial(this.seek, 30)}>
                                        <span className="glyphicon glyphicon-forward"></span>
                                    </button>
                                </div>
                                <div className="pull-right">
                                    <button type="button" className="btn btn-default" onClick={this.toggleVideo}>
                                        <span className={ 'glyphicon glyphicon-' + (this.state.video ? 'music' : 'facetime-video') }></span>
                                    </button>
                                </div>
                            </p>
                        </div>
                        <div className="col-xs-12 col-sm-7 col-md-8">
                            <dl className="dl-horizontal">
                                <dt>Date</dt>
                                <dd>
                                    <span title={episode.pubDate.format('LLLL')}>
                                        {episode.pubDate.fromNow()}
                                    </span>
                                </dd>
                                <dt>Duration</dt>
                                <dd>{episode.durationText}</dd>
                                <dt>Description</dt>
                                <dd>{episode.subtitle}</dd>
                            </dl>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
});

module.exports = IndexComponent;
