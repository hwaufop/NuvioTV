package com.nuvio.tv.ui.screens.home

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.launch

/**
 * Rebind history on profile changes so recommendations never use another
 * profile's watch progress.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
internal fun HomeViewModel.observePersonalizedRecommendationHistoryPipeline() {
    viewModelScope.launch {
        profileManager.activeProfileId
            .flatMapLatest { watchProgressRepository.allProgress }
            .distinctUntilChanged()
            .collectLatest { history ->
                recommendationHistory.value = history
                scheduleUpdateCatalogRows()
            }
    }
}
