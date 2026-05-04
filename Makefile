ARGS = `arg="$(filter-out $@,$(MAKECMDGOALS))" && echo $${arg:-${1}}`

.PHONY: changelog
changelog: install
	npx changie batch $(call ARGS,defaultstring)
	npx changie merge

.PHONY: change
change: install
	@if [ ! -d node_modules ]; then npm ci; fi
	npx changie new

.PHONY: clean
clean:
	rm -rf \
		node_modules

.PHONY: install
install:
	@if [ ! -d node_modules ]; then npm ci; fi

.PHONY: lint
lint: install
	npm run lint

.PHONY: test
test: install
	npm run test