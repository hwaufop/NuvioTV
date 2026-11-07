
package com.nuvio.tv.core.personalization

import com.nuvio.tv.domain.model.MetaPreview
import com.nuvio.tv.domain.model.WatchProgress
import javax.inject.Inject

/**
 * Learns genre preferences from a profile's watch history.
 */
class RecommendationTasteAnalyzer @Inject constructor() {

    fun analyze(
        history: List<WatchProgress>,
        availableContent: List<MetaPreview>
    ): Map<String, Int> {
        if (history.isEmpty() || availableContent.isEmpty()) {
            return emptyMap()
        }

        val contentById = availableContent
            .associateBy { "${it.apiType}:${it.id}" }

        val scores = mutableMapOf<String, Int>()

        history.forEach { progress ->
            val key = "${progress.contentType}:${progress.contentId}"
            val content = contentById[key] ?: return@forEach

            val weight = when {
                progress.isCompleted() -> 5
                progress.isInProgress() -> 2
                else -> 1
            }

            content.genres.forEach { genre ->
                val normalizedGenre = genre.trim().lowercase()

                if (normalizedGenre.isNotEmpty()) {
                    scores[normalizedGenre] =
                        (scores[normalizedGenre] ?: 0) + weight
                }
            }
        }

        return scores
    }
}
