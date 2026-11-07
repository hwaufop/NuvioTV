package com.nuvio.tv.ui.screens.home

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Rebind history on profile changes so recommendations never use another
 * profile's watch progress.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
internal fun HomeViewModel.observePersonalizedRecommendationHistoryPipeline() {
    viewModelScope.launch {
        profileManager.activeProfileId
            .flatMapLatest { profileId ->
                recommendationHistoryProfileId.value = null
                recommendationHistory.value = emptyList()
                scheduleUpdateCatalogRows()
                watchProgressRepository.allProgress
                    .map { history -> profileId to history }
            }
            .distinctUntilChanged()
            .collectLatest { (profileId, history) ->
                recommendationHistory.value = history
                recommendationHistoryProfileId.value = profileId
                scheduleUpdateCatalogRows()
            }
    }
}
