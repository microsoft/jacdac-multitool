HW = --hw stm32f401
all: deploy

build:
	pxt build $(HW)

deploy:
	pxt deploy $(HW)

test:
	pxt test
