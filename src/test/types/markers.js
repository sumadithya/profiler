/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */
// @flow

/* eslint-disable no-unused-vars, flowtype/no-unused-expressions */

import type {
  $ReplaceCauseWithStack,
  CauseBacktrace,
} from '../../types/markers';
import type { GeckoMarkerStack } from '../../types/gecko-profile';

type ObjectWithCause = {| a: number, cause: CauseBacktrace |};
type ObjectWithOptionalCause = {| a: number, cause?: CauseBacktrace |};
declare var stack: GeckoMarkerStack;
declare var cause: CauseBacktrace;

/*::
  // Test $ReplaceCauseWithStack.
  ({ a: 0 }: $ReplaceCauseWithStack<ObjectWithCause>);
  ({ a: 0 }: $ReplaceCauseWithStack<ObjectWithOptionalCause>);
  ({ a: 0, stack }: $ReplaceCauseWithStack<ObjectWithCause>);
  ({ a: 0, stack }: $ReplaceCauseWithStack<ObjectWithOptionalCause>);

  // $FlowExpectError
  ({ a: 0, stack, cause }: $ReplaceCauseWithStack<ObjectWithCause>);
  // $FlowExpectError
  ({ a: 0, stack, cause }: $ReplaceCauseWithStack<ObjectWithOptionalCause>);
*/
