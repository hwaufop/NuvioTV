package com.nuvio.tv.core.personalization

import com.nuvio.tv.domain.model.ContentType
import com.nuvio.tv.domain.model.MetaPreview
import com.nuvio.tv.domain.model.PosterShape
import com.nuvio.tv.domain.model.WatchProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecommendationTasteAnalyzerTest {
    private val analyzer = RecommendationTasteAnalyzer()

    private fun movie(id: String, genres: List<String>) = MetaPreview(
        id = id,
        type = ContentType.MOVIE,
        name = id,
        poster = null,
        posterShape = PosterShape.POSTER,
        background = null,
        logo = null,
        description = null,
        releaseInfo = null,
        imdbRating = null,
        genres = genres
    )

    private fun progress(id: String, position: Long) = WatchProgress(
        contentId = id,
        contentType = "movie",
        name = id,
        poster = null,
        backdrop = null,
        logo = null,
        videoId = id,
        season = null,
        episode = null,
        episodeTitle = null,
        position = position,
        duration = 100L,
        lastWatched = 1L
    )

    @Test
    fun completedWatchWeighsMoreThanPartialWatch() {
        val result = analyzer.analyze(
            history = listOf(progress("a", 95L), progress("b", 50L)),
            availableContent = listOf(
                movie("a", listOf("Action")),
                movie("b", listOf("Comedy"))
            )
        )

        assertEquals(5, result["action"])
        assertEquals(2, result["comedy"])
    }

    @Test
    fun unmatchedHistoryDoesNotCreatePreferences() {
        val result = analyzer.analyze(
            history = listOf(progress("missing", 100L)),
            availableContent = listOf(movie("other", listOf("Action")))
        )

        assertTrue(result.isEmpty())
    }

    @Test
    fun repeatedGenresAccumulateAcrossWatchedTitles() {
        val result = analyzer.analyze(
            history = listOf(progress("a", 95L), progress("b", 95L)),
            availableContent = listOf(
                movie("a", listOf("Science Fiction")),
                movie("b", listOf("Science Fiction"))
            )
        )

        assertEquals(10, result["science fiction"])
    }

    @Test
    fun multipleEpisodesFromSameSeriesCountAsOneTitle() {
        val show = MetaPreview(
            id = "show-1",
            type = ContentType.SERIES,
            name = "Show",
            poster = null,
            posterShape = PosterShape.POSTER,
            background = null,
            logo = null,
            description = null,
            releaseInfo = null,
            imdbRating = null,
            genres = listOf("Drama")
        )
        val episodeProgress = progress("show-1", 95L).copy(contentType = "series")

        val result = analyzer.analyze(
            history = listOf(episodeProgress, episodeProgress.copy(episode = 2)),
            availableContent = listOf(show)
        )

        assertEquals(5, result["drama"])
    }

    @Test
    fun richerDuplicateMetadataIsUsed() {
        val result = analyzer.analyze(
            history = listOf(progress("a", 95L)),
            availableContent = listOf(
                movie("a", listOf("Action")),
                movie("a", emptyList())
            )
        )

        assertEquals(5, result["action"])
    }
}
