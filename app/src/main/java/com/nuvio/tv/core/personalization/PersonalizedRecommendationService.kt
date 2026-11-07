package com.nuvio.tv.core.personalization

import com.nuvio.tv.domain.model.MetaPreview
import com.nuvio.tv.domain.model.WatchProgress
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/**
 * Coordinates local recommendation ranking and per-profile taste persistence.
 *
 * The available catalog is also used to resolve genres for watched items,
 * since WatchProgress does not contain genre information.
 */
class PersonalizedRecommendationService @Inject constructor(
    private val tasteAnalyzer: RecommendationTasteAnalyzer,
    private val preferencesStore: RecommendationPreferencesStore,
    private val engine: PersonalizedRecommendationEngine
) {
    suspend fun recommend(
        profileId: Int,
        history: List<WatchProgress>,
        availableContent: List<MetaPreview>,
        limit: Int = 30
    ): List<MetaPreview> {
        require(profileId > 0) { "Invalid profile ID" }
        if (limit <= 0 || availableContent.isEmpty()) return emptyList()

        val learnedGenres = tasteAnalyzer.analyze(history, availableContent)
        val preferences = if (learnedGenres.isNotEmpty()) {
            preferencesStore.savePreferredGenres(profileId, learnedGenres)
            learnedGenres
        } else {
            // Preserve previously learned tastes when watched titles are absent
            // from the currently loaded catalog.
            preferencesStore.observePreferredGenres(profileId).first()
        }

        // Without any genre signal this would only sort by rating, not taste.
        if (preferences.values.none { it > 0 }) return emptyList()

        val watchedIds = history.mapTo(mutableSetOf()) { progress ->
            "${progress.contentType.trim().lowercase()}:${progress.contentId}"
        }

        return engine.recommend(
            profileId = profileId,
            candidates = availableContent,
            preferredGenres = preferences,
            watchedContentIds = watchedIds,
            limit = limit
        )
    }
}
