/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { createSelector } from 'reselect';
import * as UrlState from '../url-state';
import * as ProfileData from '../../profile-logic/profile-data';
import * as StackTiming from '../../profile-logic/stack-timing';
import * as FlameGraph from '../../profile-logic/flame-graph';
import * as CallTree from '../../profile-logic/call-tree';
import { PathSet } from '../../utils/path';
import * as ProfileSelectors from '../profile';
import { assertExhaustiveCheck, ensureExists } from '../../utils/flow';

import type {
  Thread,
  SamplesTable,
  JsAllocationsTable,
  NativeAllocationsTable,
  IndexIntoCategoryList,
  IndexIntoSamplesTable,
} from '../../types/profile';
import type {
  CallNodeInfo,
  CallNodePath,
  IndexIntoCallNodeTable,
  SelectedState,
} from '../../types/profile-derived';
import type { StartEndRange } from '../../types/units';
import type { Selector } from '../../types/store';
import type { $ReturnType } from '../../types/utils';
import type { CallTreeSummaryStrategy } from '../../types/actions';
import type { ThreadSelectorsPerThread } from './thread';

/**
 * Infer the return type from the getStackAndSampleSelectorsPerThread function. This
 * is done that so that the local type definition with `Selector<T>` is the canonical
 * definition for the type of the selector.
 */
export type StackAndSampleSelectorsPerThread = $ReturnType<
  typeof getStackAndSampleSelectorsPerThread
>;

/**
 * Create the selectors for a thread that have to do with either stacks or samples.
 */
export function getStackAndSampleSelectorsPerThread(
  threadSelectors: ThreadSelectorsPerThread
): * {
  /**
   * The buffers of the samples can be cleared out. This function lets us know the
   * absolute range of samples that we have collected.
   */
  const unfilteredSamplesRange: Selector<StartEndRange | null> = createSelector(
    threadSelectors.getThread,
    ProfileSelectors.getProfileInterval,
    (thread, interval) => {
      const { time } = thread.samples;
      if (time.length === 0) {
        return null;
      }
      return { start: time[0], end: time[time.length - 1] + interval };
    }
  );

  const getCallNodeInfo: Selector<CallNodeInfo> = createSelector(
    threadSelectors.getFilteredThread,
    ProfileSelectors.getDefaultCategory,
    (
      { stackTable, frameTable, funcTable }: Thread,
      defaultCategory: IndexIntoCategoryList
    ): CallNodeInfo => {
      return ProfileData.getCallNodeInfo(
        stackTable,
        frameTable,
        funcTable,
        defaultCategory
      );
    }
  );

  const getCallNodeMaxDepth: Selector<number> = createSelector(
    threadSelectors.getFilteredThread,
    getCallNodeInfo,
    ProfileData.computeCallNodeMaxDepth
  );

  const getSelectedCallNodePath: Selector<CallNodePath> = createSelector(
    threadSelectors.getViewOptions,
    (threadViewOptions): CallNodePath => threadViewOptions.selectedCallNodePath
  );

  const getSelectedCallNodeIndex: Selector<IndexIntoCallNodeTable | null> = createSelector(
    getCallNodeInfo,
    getSelectedCallNodePath,
    (callNodeInfo, callNodePath) => {
      return ProfileData.getCallNodeIndexFromPath(
        callNodePath,
        callNodeInfo.callNodeTable
      );
    }
  );

  const getRightClickedCallNodePath: Selector<CallNodePath | null> = state =>
    threadSelectors.getViewOptions(state).rightClickedCallNodePath;

  const getRightClickedCallNodeIndex: Selector<IndexIntoCallNodeTable | null> = createSelector(
    getCallNodeInfo,
    getRightClickedCallNodePath,
    ({ callNodeTable }, callNodePath): IndexIntoCallNodeTable | null => {
      if (callNodePath === null) {
        return null;
      }

      return ProfileData.getCallNodeIndexFromPath(callNodePath, callNodeTable);
    }
  );

  const getExpandedCallNodePaths: Selector<PathSet> = createSelector(
    threadSelectors.getViewOptions,
    threadViewOptions => threadViewOptions.expandedCallNodePaths
  );

  const getExpandedCallNodeIndexes: Selector<
    Array<IndexIntoCallNodeTable | null>
  > = createSelector(
    getCallNodeInfo,
    getExpandedCallNodePaths,
    ({ callNodeTable }, callNodePaths) =>
      ProfileData.getCallNodeIndicesFromPaths(
        Array.from(callNodePaths),
        callNodeTable
      )
  );

  const getSamplesSelectedStatesInFilteredThread: Selector<
    null | SelectedState[]
  > = createSelector(
    threadSelectors.getFilteredThread,
    threadSelectors.getTabFilteredThread,
    getCallNodeInfo,
    getSelectedCallNodeIndex,
    (
      thread,
      tabFilteredThread,
      { callNodeTable, stackIndexToCallNodeIndex },
      selectedCallNode
    ) => {
      if (thread.isJsTracer) {
        // This is currently to slow to compute in JS Tracer threads.
        return null;
      }
      const sampleIndexToCallNodeIndex = ProfileData.getSampleIndexToCallNodeIndex(
        thread.samples.stack,
        stackIndexToCallNodeIndex
      );
      const activeTabFilteredCallNodeIndex = ProfileData.getSampleIndexToCallNodeIndex(
        tabFilteredThread.samples.stack,
        stackIndexToCallNodeIndex
      );
      return ProfileData.getSamplesSelectedStates(
        callNodeTable,
        sampleIndexToCallNodeIndex,
        activeTabFilteredCallNodeIndex,
        selectedCallNode
      );
    }
  );

  const getTreeOrderComparatorInFilteredThread: Selector<
    (IndexIntoSamplesTable, IndexIntoSamplesTable) => number
  > = createSelector(
    threadSelectors.getFilteredThread,
    getCallNodeInfo,
    (thread, { callNodeTable, stackIndexToCallNodeIndex }) => {
      const sampleIndexToCallNodeIndex = ProfileData.getSampleIndexToCallNodeIndex(
        thread.samples.stack,
        stackIndexToCallNodeIndex
      );
      return ProfileData.getTreeOrderComparator(
        callNodeTable,
        sampleIndexToCallNodeIndex
      );
    }
  );

  /**
   * The CallTreeSummaryStrategy determines how the call tree summarizes the
   * the current thread. By default, this is done by timing, but other
   * methods are also available. This selectors also ensures that the current
   * thread supports the last selected call tree summary strategy.
   */
  const getCallTreeSummaryStrategy: Selector<CallTreeSummaryStrategy> = createSelector(
    threadSelectors.getThread,
    UrlState.getLastSelectedCallTreeSummaryStrategy,
    (thread, lastSelectedCallTreeSummaryStrategy) => {
      switch (lastSelectedCallTreeSummaryStrategy) {
        case 'timing':
          // Timing is valid everywhere.
          break;
        case 'js-allocations':
          if (!thread.jsAllocations) {
            // Attempting to view a thread with no JS allocations, switch back to timing.
            return 'timing';
          }
          break;
        case 'native-allocations':
        case 'native-retained-allocations':
        case 'native-deallocations-sites':
        case 'native-deallocations-memory':
          if (!thread.nativeAllocations) {
            // Attempting to view a thread with no native allocations, switch back
            // to timing.
            return 'timing';
          }
          break;
        default:
          assertExhaustiveCheck(
            lastSelectedCallTreeSummaryStrategy,
            'Unhandled call tree sumary strategy.'
          );
      }
      return lastSelectedCallTreeSummaryStrategy;
    }
  );

  const getSamplesForCallTree: Selector<
    SamplesTable | JsAllocationsTable | NativeAllocationsTable
  > = createSelector(
    threadSelectors.getPreviewFilteredThread,
    getCallTreeSummaryStrategy,
    (thread, strategy) => {
      switch (strategy) {
        case 'timing':
          return thread.samples;
        case 'js-allocations':
          return ensureExists(
            thread.jsAllocations,
            'Expected the NativeAllocationTable to exist when using a "js-allocation" strategy'
          );
        case 'native-retained-allocations': {
          const nativeAllocations = ensureExists(
            thread.nativeAllocations,
            'Expected the NativeAllocationTable to exist when using a "native-allocation" strategy'
          );

          if (!nativeAllocations.memoryAddress) {
            throw new Error(
              'Attempting to filter by retained allocations data that is missing the memory addresses.'
            );
          }
          return ProfileData.filterToRetainedAllocations(nativeAllocations);
        }
        case 'native-allocations':
          return ProfileData.filterToAllocations(
            ensureExists(
              thread.nativeAllocations,
              'Expected the NativeAllocationTable to exist when using a "native-allocations" strategy'
            )
          );
        case 'native-deallocations-sites':
          return ProfileData.filterToDeallocationsSites(
            ensureExists(
              thread.nativeAllocations,
              'Expected the NativeAllocationTable to exist when using a "native-deallocations-sites" strategy'
            )
          );
        case 'native-deallocations-memory': {
          const nativeAllocations = ensureExists(
            thread.nativeAllocations,
            'Expected the NativeAllocationTable to exist when using a "native-deallocations-memory" strategy'
          );

          if (!nativeAllocations.memoryAddress) {
            throw new Error(
              'Attempting to filter by retained allocations data that is missing the memory addresses.'
            );
          }

          return ProfileData.filterToDeallocationsMemory(
            ensureExists(
              nativeAllocations,
              'Expected the NativeAllocationTable to exist when using a "js-allocation" strategy'
            )
          );
        }
        default:
          throw assertExhaustiveCheck(strategy);
      }
    }
  );

  const getCallTreeCountsAndTimings: Selector<CallTree.CallTreeCountsAndTimings> = createSelector(
    getSamplesForCallTree,
    getCallNodeInfo,
    ProfileSelectors.getProfileInterval,
    UrlState.getInvertCallstack,
    CallTree.computeCallTreeCountsAndTimings
  );

  const getCallTree: Selector<CallTree.CallTree> = createSelector(
    threadSelectors.getPreviewFilteredThread,
    ProfileSelectors.getProfileInterval,
    getCallNodeInfo,
    ProfileSelectors.getCategories,
    UrlState.getImplementationFilter,
    getCallTreeCountsAndTimings,
    getCallTreeSummaryStrategy,
    CallTree.getCallTree
  );

  const getStackTimingByDepth: Selector<StackTiming.StackTimingByDepth> = createSelector(
    threadSelectors.getFilteredThread,
    getCallNodeInfo,
    getCallNodeMaxDepth,
    ProfileSelectors.getProfileInterval,
    StackTiming.getStackTimingByDepth
  );

  const getCallNodeMaxDepthForFlameGraph: Selector<number> = createSelector(
    threadSelectors.getPreviewFilteredThread,
    getCallNodeInfo,
    ProfileData.computeCallNodeMaxDepth
  );

  const getFlameGraphTiming: Selector<FlameGraph.FlameGraphTiming> = createSelector(
    threadSelectors.getPreviewFilteredThread,
    getCallNodeInfo,
    getCallTreeCountsAndTimings,
    FlameGraph.getFlameGraphTiming
  );

  return {
    unfilteredSamplesRange,
    getCallNodeInfo,
    getCallNodeMaxDepth,
    getSelectedCallNodePath,
    getSelectedCallNodeIndex,
    getRightClickedCallNodePath,
    getRightClickedCallNodeIndex,
    getExpandedCallNodePaths,
    getExpandedCallNodeIndexes,
    getSamplesSelectedStatesInFilteredThread,
    getTreeOrderComparatorInFilteredThread,
    getCallTreeSummaryStrategy,
    getCallTree,
    getStackTimingByDepth,
    getCallNodeMaxDepthForFlameGraph,
    getFlameGraphTiming,
  };
}
