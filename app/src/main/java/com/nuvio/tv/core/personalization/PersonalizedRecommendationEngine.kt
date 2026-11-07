
package com.nuvio.tv.core.personalization

import com.nuvio.tv.domain.model.MetaPreview
import javax.inject.Inject

/**
 * Classe les contenus selon les préférences d'un profil.
 *
 * Ce premier moteur est local et ne nécessite
 * aucun service externe.
 */
class PersonalizedRecommendationEngine @Inject constructor() {

    fun recommend(
        profileId: Int,
        candidates: List<MetaPreview>,
        preferredGenres: Map<String, Int>,
        watchedContentIds: Set<String> = emptySet(),
        limit: Int = 30
    ): List<MetaPreview> {
        require(profileId > 0) {
            "Invalid profile ID"
        }

        if (limit <= 0) return emptyList()

        val normalizedPreferences = preferredGenres
            .mapKeys { (genre, _) ->
                genre.trim().lowercase()
            }

        return candidates
            .asSequence()
            .distinctBy { "${it.apiType}:${it.id}" }
            .filter { candidate ->
                "${candidate.apiType}:${candidate.id}" !in watchedContentIds
            }
            .sortedWith(
                compareByDescending<MetaPreview> { candidate ->
                    calculateScore(
                        candidate,
                        normalizedPreferences
                    )
                }.thenBy { it.name }
            )
            .take(limit)
            .toList()
    }

    private fun calculateScore(
        candidate: MetaPreview,
        preferredGenres: Map<String, Int>
    ): Double {
        val genreScore = candidate.genres.sumOf { genre ->
            preferredGenres[
                genre.trim().lowercase()
            ]?.coerceAtLeast(0) ?: 0
        }

        val ratingScore = (
            candidate.imdbRating
                ?.coerceIn(0f, 10f)
                ?: 0f
        ).toDouble()

        return genreScore * 10.0 + ratingScore
    }
}
