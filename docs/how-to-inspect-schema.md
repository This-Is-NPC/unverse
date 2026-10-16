# Inspect a mapped schema

**The question:** What metadata exists under the publisher prefix I intend
to manage?

This page needs [a connected environment](how-to-connect-an-environment.md).

## Before you start

Install the candidate and identify the existing solution's unique name and
publisher prefix. `uv` and `UnverseFixture` below are placeholders, not names
to reuse in an existing environment. Metadata read permissions are required.

## Steps

1. Inspect the explicit namespace:

   ```sh
   unverse schema inspect --env dev --prefix uv --solution UnverseFixture --json
   ```

   The installed synthetic fixture produced `data.entities: []` for an empty
   namespace. Live DEV verification inspected a fresh, uniquely generated
   fixture namespace before and after provisioning.

2. Inspect each column's `definition` and `providerType`. Unknown semantics
   remain `definition: null`, not an assumed supported type. Logical and
   computed companion attributes are excluded from the managed structure.

## What can go wrong

A prefix covers all matching custom entities, not merely one solution's
membership. Use a dedicated prefix; a plan will block removal of observed
entities or fields omitted from the model. Missing permissions remain errors.
Platform-required levels are not server-side nullability guarantees.

## Next

[Plan an additive change](how-to-plan-schema.md).
