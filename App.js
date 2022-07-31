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
      <StatusBar />
      <NavigationContainer ref={containerRef}>
        <BottomNavigator />
      </NavigationContainer>
    </>
  );
};

export default App;
