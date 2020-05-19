/**
 * Bluelytics
 *
 * @format
 * @flow strict-local
 */

import React from 'react';
import {StyleSheet, StatusBar} from 'react-native';

import {useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';

import BottomNavigator from './navigator/BottomNavigator';

const Stack = createStackNavigator();

const App: () => React$Node = () => {
  const containerRef = useRef();

  return (
    <>
      <StatusBar barStyle="light-content" />
      <NavigationContainer ref={containerRef}>
        <Stack.Navigator>
          <Stack.Screen name="Root" component={BottomNavigator} />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

export default App;
