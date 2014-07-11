var gulp = require('gulp');
var gutil = require('gulp-util');
var streamify = require('gulp-streamify');
var uglify = require('gulp-uglify');
var source = require('vinyl-source-stream');
var watchify = require('watchify');
var browserify = require('browserify');
var reactify = require('reactify');

gulp.task('default', function () {
    var bundler = watchify('./src/main.js', {
        debug : gutil.env.type !== 'production'
    });

    bundler.transform('reactify')

    if (gutil.env.type === 'production') {
        bundler.close();
    } else {
        bundler.on('update', rebundle)
    }

    function rebundle() {
        gutil.log('Browserifying...');
        return bundler.bundle()
            .on('error', function(e) {
                gutil.log('Browserify Error', e);
            })
            .pipe(source('bundle.js'))
            .pipe(gutil.env.type === 'production' ? streamify(uglify()) : gutil.noop())
            .pipe(gulp.dest('./js'))
            .pipe(gutil.noop(gutil.log('Done.')))
    }

    return rebundle();
});