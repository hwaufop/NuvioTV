package com.nuvio.tv.core.personalization

import com.nuvio.tv.domain.model.ContentType
import com.nuvio.tv.domain.model.MetaPreview
import com.nuvio.tv.domain.model.PosterShape
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalizedRecommendationEngineTest {
    private val engine = PersonalizedRecommendationEngine()

    private fun movie(
        id: String,
        genre: String,
        rating: Float = 7f
    ) = MetaPreview(
        id = id,
        type = ContentType.MOVIE,
        name = id,
        poster = null,
        posterShape = PosterShape.POSTER,
        background = null,
        logo = null,
        description = null,
        releaseInfo = null,
        imdbRating = rating,
        genres = listOf(genre)
    )

    @Test
    fun preferredGenresAreRankedAheadOfRating() {
        val action = movie("action", "Action", 6f)
        val romance = movie("romance", "Romance", 9f)

        val results = engine.recommend(
            profileId = 1,
            candidates = listOf(romance, action),
            preferredGenres = mapOf("action" to 3)
        )

        assertEquals(listOf("action", "romance"), results.map { it.id })
    }

    @Test
    fun watchedItemsAreExcludedAndDuplicatesRemoved() {
        val seen = movie("watched", "Action")
        val newMovie = movie("new", "Action")

        val results = engine.recommend(
            profileId = 2,
            candidates = listOf(seen, newMovie, newMovie),
            preferredGenres = mapOf("action" to 1),
            watchedContentIds = setOf("movie:watched")
        )

        assertEquals(listOf("new"), results.map { it.id })
    }

    @Test
    fun resultLimitIsRespected() {
        val results = engine.recommend(
            profileId = 1,
            candidates = listOf(movie("a", "Action"), movie("b", "Action")),
            preferredGenres = mapOf("action" to 1),
            limit = 1
        )

        assertEquals(1, results.size)
        assertTrue(results.first().id in setOf("a", "b"))
    }

    @Test
    fun imdbAliasOfWatchedTitleIsExcluded() {
        val alias = movie("tmdb:42", "Action").copy(imdbId = "tt0000042")
        val results = engine.recommend(
            profileId = 1,
            candidates = listOf(alias),
            preferredGenres = mapOf("action" to 1),
            watchedContentIds = setOf("movie:tt0000042")
        )

        assertTrue(results.isEmpty())
    }
}
