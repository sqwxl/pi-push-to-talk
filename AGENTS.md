# Agent Notes

## Release

Run these steps on a clean `main` checkout. Stop before publish: the user publishes by hand.

1. Run the tests. Fix every failure before you continue.

   ```sh
   node --test src/*.test.ts
   ```

2. Bump the version and create the tag. Use `patch` for fixes, `minor` for features, `major` for breaking changes. Before 1.0, a breaking change takes `minor`.

   ```sh
   npm version patch -m "chore: release %s"
   ```

3. Regenerate the changelog. It reads git tags, so run this after step 2.

   ```sh
   npm run changelog
   ```

4. Read `CHANGELOG.md`, then commit it.

   ```sh
   git commit -am "docs: update changelog for <version>"
   ```

5. Push the branch and the tag.

   ```sh
   git push --follow-tags
   ```

6. Ask the user to publish. Do not run `npm publish` yourself.

   ```sh
   npm publish
   ```

## Notes

- `npm version` refuses a dirty tree. Commit or revert other work first.
- The changelog lists only `feat` and `fix` commits. Release, `chore`, `docs`, `test`, `build`, and `ci` commits are hidden.
- The tag points at the release commit. The changelog commit comes after it. `npm publish` from the working tree includes `CHANGELOG.md`.
- Pi shows changelog entries newer than the version the user last ran. Keep the version headings in `## [x.y.z] - date` form.
