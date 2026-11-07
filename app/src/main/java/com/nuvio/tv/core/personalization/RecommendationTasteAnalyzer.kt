
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

        // One title may appear in several addons. Prefer the copy with the
        // richest genre metadata instead of accidentally keeping an empty one.
        val contentById = buildMap {
            availableContent.sortedBy { it.genres.size }.forEach { item ->
                val type = item.apiType.trim().lowercase()
                put("$type:${item.id}", item)
                item.imdbId?.takeIf { it.isNotBlank() }?.let { imdbId ->
                    put("$type:$imdbId", item)
                }
            }
        }

        val scores = mutableMapOf<String, Int>()

        // An entire TV season should not outweigh every film just because
        // its episodes were saved as separate progress entries.
        // allProgress is ordered most-recent-first by the repository.
        history.distinctBy { progress ->
            "${progress.contentType.trim().lowercase()}:${progress.contentId}"
        }.forEach { progress ->
            val key = "${progress.contentType.trim().lowercase()}:${progress.contentId}"
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
